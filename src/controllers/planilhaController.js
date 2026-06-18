const multer = require('multer');
const axios  = require('axios');
const pdfParse = require('pdf-parse');
const db = require('../database/db');

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const PNCP_SEARCH_URL = 'https://api.mercadolibre.com/sites/MLB/search';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    cb(null, ok);
  },
});

// POST /api/planilha/extrair-itens
async function extrairItens(req, res) {
  try {
    const { paginas, cliente_id, pregao_id, titulo } = req.body;
    const arquivo = req.file;
    if (!arquivo) return res.status(400).json({ erro: 'Arquivo não enviado.' });

    const isImagem = arquivo.mimetype.startsWith('image/');
    let mensagens;

    if (isImagem) {
      mensagens = [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: arquivo.mimetype, data: arquivo.buffer.toString('base64') },
          },
          {
            type: 'text',
            text: `Analise esta imagem de um edital de licitação pública brasileira e extraia TODOS os itens/lotes listados.
Retorne APENAS um JSON válido, sem explicações, sem markdown:
{"itens":[{"numero_item":1,"descricao":"descrição completa","unidade":"un","quantidade":100,"valor_estimado":25.90}]}
Se um campo não estiver visível, use null. Não invente valores.`,
          },
        ],
      }];
    } else {
      const pdfData = await pdfParse(arquivo.buffer);
      const conteudo = pdfData.text;

      mensagens = [{
        role: 'user',
        content: `Analise o conteúdo abaixo de um edital de licitação pública brasileira e extraia TODOS os itens/lotes.
${paginas ? `Foque nas páginas: ${paginas}` : ''}

Retorne APENAS um JSON válido, sem explicações, sem markdown, sem blocos de código:
{"itens":[{"numero_item":1,"descricao":"descrição completa","unidade":"un","quantidade":100,"valor_estimado":25.90}]}

Se um campo não estiver disponível, use null. Não invente valores. Extraia apenas o que está no documento.

CONTEÚDO DO EDITAL:
${conteudo.slice(0, 12000)}`,
      }];
    }

    const respIA = await axios.post(
      ANTHROPIC_URL,
      {
        model: process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5',
        max_tokens: 4000,
        messages: mensagens,
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    const rawJSON = respIA.data.content?.[0]?.text || '{}';
    const cleanJSON = rawJSON.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleanJSON);
    } catch {
      return res.status(422).json({ erro: 'A IA não retornou JSON válido. Tente novamente ou use páginas mais específicas.' });
    }
    const itens = parsed.itens || [];

    if (!itens.length) {
      return res.status(422).json({ erro: 'Nenhum item encontrado. Verifique o arquivo e as páginas indicadas.' });
    }

    const { rows: [planilha] } = await db.query(
      `INSERT INTO proposta_planilhas (cliente_id, pregao_id, titulo, arquivo_origem, paginas_itens, status)
       VALUES ($1, $2, $3, $4, $5, 'ativo') RETURNING *`,
      [cliente_id || null, pregao_id || null, titulo || arquivo.originalname, arquivo.originalname, paginas || null],
    );

    const itensParaInserir = itens.map((it, idx) => [
      planilha.id,
      it.numero_item ?? (idx + 1),
      it.descricao,
      it.unidade || null,
      it.quantidade || null,
      it.valor_estimado || null,
    ]);

    const itensSalvos = [];
    for (const vals of itensParaInserir) {
      const { rows } = await db.query(
        `INSERT INTO proposta_itens (planilha_id, numero_item, descricao, unidade, quantidade, valor_estimado)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        vals,
      );
      itensSalvos.push(rows[0]);
    }

    res.json({ planilha_id: planilha.id, itens: itensSalvos });
  } catch (err) {
    console.error('[planilha/extrair-itens]', err.message);
    res.status(500).json({ erro: 'Erro ao processar edital.', detalhe: err.message });
  }
}

// GET /api/planilha/planilhas
async function listarPlanilhas(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT p.*, COUNT(i.id)::int AS total_itens
      FROM proposta_planilhas p
      LEFT JOIN proposta_itens i ON i.planilha_id = p.id
      GROUP BY p.id
      ORDER BY p.criado_em DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[planilha/planilhas]', err.message);
    res.status(500).json({ erro: err.message });
  }
}

// GET /api/planilha/planilhas/:id/itens
async function listarItens(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM proposta_itens WHERE planilha_id = $1 ORDER BY numero_item`,
      [req.params.id],
    );
    res.json(rows);
  } catch (err) {
    console.error('[planilha/planilhas/:id/itens]', err.message);
    res.status(500).json({ erro: err.message });
  }
}

// PATCH /api/planilha/itens/:id
async function atualizarItem(req, res) {
  try {
    const { valor_minimo, marca_modelo } = req.body;
    const updates = ['atualizado_em = NOW()'];
    const vals = [];
    let idx = 1;
    if (valor_minimo !== undefined) { updates.push(`valor_minimo = $${idx++}`); vals.push(valor_minimo === '' ? null : Number(valor_minimo)); }
    if (marca_modelo !== undefined) { updates.push(`marca_modelo = $${idx++}`); vals.push(marca_modelo || null); }
    vals.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE proposta_itens SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals,
    );
    if (!rows.length) return res.status(404).json({ erro: 'Item não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[planilha/itens PATCH]', err.message);
    res.status(500).json({ erro: err.message });
  }
}

// GET /api/planilha/buscar-preco?q=...&item_id=...
async function buscarPreco(req, res) {
  try {
    const { q, item_id } = req.query;
    if (!q) return res.status(400).json({ erro: 'Parâmetro q obrigatório.' });

    const resp = await axios.get(PNCP_SEARCH_URL, {
      params: { q, limit: 5, sort: 'price_asc' },
      timeout: 10000,
    });

    const results = (resp.data.results || []).map(r => ({
      id: r.id,
      titulo: r.title,
      preco: r.price,
      link: r.permalink,
      thumbnail: r.thumbnail,
      vendedor: r.seller?.nickname || '',
      quantidade_disponivel: r.available_quantity,
    }));

    if (item_id && results.length > 0) {
      const melhor = results[0];
      await db.query(
        `UPDATE proposta_itens SET ml_preco_encontrado=$1, ml_link=$2, ml_produto_id=$3, atualizado_em=NOW() WHERE id=$4`,
        [melhor.preco, melhor.link, melhor.id, item_id],
      );
    }

    res.json(results);
  } catch (err) {
    console.error('[planilha/buscar-preco]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar no Mercado Livre.', detalhe: err.message });
  }
}

// GET /api/planilha/planilhas/:id/exportar-csv
async function exportarCSV(req, res) {
  try {
    const { rows: [planilha] } = await db.query(
      `SELECT titulo FROM proposta_planilhas WHERE id = $1`, [req.params.id],
    );
    const { rows: itens } = await db.query(
      `SELECT * FROM proposta_itens WHERE planilha_id = $1 ORDER BY numero_item`, [req.params.id],
    );

    const cabecalho = ['Nº', 'Descrição', 'Unidade', 'Quantidade', 'Valor Estimado (R$)', 'Valor Mínimo (R$)', 'Marca/Modelo', 'Preço ML (R$)', 'Link ML'];
    const linhas = itens.map(it => [
      it.numero_item ?? '',
      it.descricao ?? '',
      it.unidade ?? '',
      it.quantidade ?? '',
      it.valor_estimado ?? '',
      it.valor_minimo ?? '',
      it.marca_modelo ?? '',
      it.ml_preco_encontrado ?? '',
      it.ml_link ?? '',
    ]);

    const csv = [cabecalho, ...linhas]
      .map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const nomeArquivo = `proposta-${(planilha?.titulo || 'edital').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.send('﻿' + csv);
  } catch (err) {
    console.error('[planilha/exportar-csv]', err.message);
    res.status(500).json({ erro: err.message });
  }
}

module.exports = { upload, extrairItens, listarPlanilhas, listarItens, atualizarItem, buscarPreco, exportarCSV };
