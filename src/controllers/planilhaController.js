const multer   = require('multer');
const axios    = require('axios');
const pdfParse = require('pdf-parse');
const db       = require('../database/db');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ML_SEARCH_URL = 'https://api.mercadolibre.com/sites/MLB/search';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/'));
  },
});

// ── Prompt compartilhado ──────────────────────────────────────────────────────
const INSTRUCAO_JSON = `Retorne APENAS um JSON válido, sem explicações, sem markdown, sem blocos de código:
{"itens":[{"numero_item":1,"descricao":"descrição completa do item","unidade":"UN","quantidade":100,"valor_estimado":25.90}]}

Regras gerais: campo ausente → null | não invente valores | inclua TODOS os itens | lotes → itens individuais

Regras OBRIGATÓRIAS para os campos:
"unidade": APENAS embalagem ou medida resumida e abreviada. Ex corretos: "UN","CX","KG","M²","M³","L","SACO 20KG","GALÃO 18L","ROLO 50M","PCT". Ex ERRADOS: "SACO 20,00 QUILOGRAMA","METRO CUBICO","UNIDADE". Abreviações: QUILOGRAMA→KG, LITRO→L, METRO→M, METRO CUBICO→M³, METRO QUADRADO→M², UNIDADE→UN, CAIXA→CX, PACOTE→PCT. NUNCA inclua a quantidade do pedido na unidade.
"quantidade": número inteiro ou decimal de quantas unidades o edital pede. Nunca inclua a unidade aqui.
"valor_estimado": valor UNITÁRIO por unidade conforme o edital. Se o edital mostrar apenas valor total, divida pela quantidade. NUNCA o valor total.`;

function promptTexto(conteudo, paginas) {
  return `Você é especialista em licitações públicas brasileiras.
Analise o texto abaixo extraído de um edital e extraia TODOS os itens/lotes listados para compra.
${paginas ? `O usuário indicou que os itens estão próximas das páginas: ${paginas}. Priorize essa região, mas extraia todos os itens encontrados.` : 'Encontre automaticamente onde estão os itens no documento.'}
Itens geralmente aparecem em tabelas ou listas com: número, descrição, unidade (un/cx/kg/m/lt), quantidade e valor estimado.
${INSTRUCAO_JSON}

TEXTO DO EDITAL:
${conteudo}`;
}

const PROMPT_VISUAL = `Você é especialista em licitações públicas brasileiras.
Analise as páginas do edital nas imagens acima e extraia TODOS os itens/lotes listados para compra.
Se não houver itens nessas páginas, retorne {"itens":[]}.
${INSTRUCAO_JSON}`;

// ── Chamada Anthropic ─────────────────────────────────────────────────────────
async function callClaude(messages) {
  const resp = await axios.post(
    ANTHROPIC_URL,
    { model: process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5', max_tokens: 4000, messages },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    },
  );
  return resp.data.content?.[0]?.text || '{}';
}

function parseItens(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean).itens || [];
  } catch {
    console.warn('[planilha] JSON inválido da IA:', raw.slice(0, 200));
    return [];
  }
}

// ── Fallback visual: envia PDF completo como documento nativo do Claude ───────
// Claude 3.x suporta type:"document" com media_type:"application/pdf" — sem dependências nativas
async function extrairItensPorVisao(pdfBuffer, paginas) {
  console.log('[planilha] Ativando fallback visual — enviando PDF nativo ao Claude');
  const base64 = pdfBuffer.toString('base64');

  const content = [
    {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    },
    { type: 'text', text: PROMPT_VISUAL + (paginas ? `\nFoque especialmente nas páginas: ${paginas}` : '') },
  ];

  try {
    const raw = await callClaude([{ role: 'user', content }]);
    return parseItens(raw);
  } catch (err) {
    console.error('[planilha] fallback visual falhou:', err.message);
    return [];
  }
}

// ── POST /api/planilha/extrair-itens ─────────────────────────────────────────
async function extrairItens(req, res) {
  try {
    const { paginas, cliente_id, pregao_id, titulo } = req.body;
    const arquivo = req.file;
    if (!arquivo) return res.status(400).json({ erro: 'Arquivo não enviado.' });

    let itens = [];

    // ── Caminho B: imagem direta ──────────────────────────────────────────────
    if (arquivo.mimetype.startsWith('image/')) {
      const raw = await callClaude([{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: arquivo.mimetype, data: arquivo.buffer.toString('base64') } },
          { type: 'text', text: `Você é especialista em licitações públicas brasileiras.
Analise esta imagem de um edital e extraia TODOS os itens listados para compra.
${INSTRUCAO_JSON}` },
        ],
      }]);
      itens = parseItens(raw);

    // ── Caminho A: PDF ────────────────────────────────────────────────────────
    } else if (arquivo.mimetype === 'application/pdf') {
      let textoPDF = '';
      try {
        const pdfData = await pdfParse(arquivo.buffer);
        textoPDF = pdfData.text || '';
      } catch (e) {
        console.warn('[planilha] pdf-parse falhou:', e.message);
      }

      const temTexto = textoPDF.replace(/\s/g, '').length > 100;

      if (temTexto) {
        // A1: PDF com texto selecionável — manda texto ao Claude
        console.log('[planilha] PDF com texto — extração via texto');
        const raw = await callClaude([{
          role: 'user',
          content: promptTexto(textoPDF.slice(0, 15000), paginas),
        }]);
        itens = parseItens(raw);
      }

      // A2: PDF escaneado OU texto não gerou itens → fallback visual (PDF nativo)
      if (!temTexto || itens.length === 0) {
        itens = await extrairItensPorVisao(arquivo.buffer, paginas);
      }

    } else {
      return res.status(400).json({ erro: 'Formato não suportado. Envie PDF ou imagem (JPG, PNG).' });
    }

    if (!itens.length) {
      return res.status(422).json({
        erro: 'Nenhum item encontrado no edital. Verifique se o PDF está legível ou tente enviar como imagem.',
      });
    }

    // ── Salvar no banco ───────────────────────────────────────────────────────
    const { rows: [planilha] } = await db.query(
      `INSERT INTO proposta_planilhas (cliente_id, pregao_id, titulo, arquivo_origem, paginas_itens, status)
       VALUES ($1, $2, $3, $4, $5, 'ativo') RETURNING *`,
      [cliente_id || null, pregao_id || null, titulo || arquivo.originalname, arquivo.originalname, paginas || 'auto'],
    );

    const itensSalvos = [];
    for (const [idx, it] of itens.entries()) {
      const { rows } = await db.query(
        `INSERT INTO proposta_itens (planilha_id, numero_item, descricao, unidade, quantidade, valor_estimado)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [planilha.id, it.numero_item ?? (idx + 1), it.descricao || '', it.unidade || null, it.quantidade || null, it.valor_estimado || null],
      );
      itensSalvos.push(rows[0]);
    }

    res.json({ planilha_id: planilha.id, itens: itensSalvos });

  } catch (err) {
    console.error('[planilha/extrair-itens] ERRO:', err.message);
    res.status(500).json({ erro: 'Erro ao processar edital.', detalhe: err.message });
  }
}

// ── GET /api/planilha/planilhas ───────────────────────────────────────────────
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

// ── GET /api/planilha/planilhas/:id/itens ────────────────────────────────────
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

// ── PATCH /api/planilha/itens/:id ────────────────────────────────────────────
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

// ── Simplificar termo de busca com IA ────────────────────────────────────────
async function simplificarTermoBusca(descricao) {
  try {
    const resp = await axios.post(
      ANTHROPIC_URL,
      {
        model: process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5',
        max_tokens: 60,
        messages: [{
          role: 'user',
          content: `Simplifique esta descrição técnica de licitação para um termo de busca curto (máximo 5 palavras) que funcione bem no Mercado Livre. Retorne APENAS o termo, sem explicações.\n\nDescrição: ${descricao}`,
        }],
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    );
    return resp.data?.content?.[0]?.text?.trim() || descricao.split(' ').slice(0, 4).join(' ');
  } catch (e) {
    return descricao.split(' ').slice(0, 4).join(' ');
  }
}

// ── GET /api/planilha/buscar-preco ───────────────────────────────────────────
async function buscarPreco(req, res) {
  try {
    const { q, item_id } = req.query;
    if (!q) return res.status(400).json({ erro: 'Parâmetro q obrigatório.' });

    let results = [];
    let fonte = '';

    const termoSimplificado = await simplificarTermoBusca(q);
    console.log(`[planilha/buscar-preco] "${q}" → "${termoSimplificado}"`);

    // Tentativa 1: Mercado Livre com termo simplificado
    try {
      const respML = await axios.get(ML_SEARCH_URL, {
        params: { q: termoSimplificado, limit: 5, sort: 'price_asc' },
        timeout: 8000,
      });
      const itensML = (respML.data.results || []);
      if (itensML.length > 0) {
        results = itensML.map(r => ({
          id: r.id,
          titulo: r.title,
          preco: r.price,
          link: r.permalink,
          thumbnail: r.thumbnail,
          vendedor: r.seller?.nickname || 'Mercado Livre',
          fonte: 'Mercado Livre',
          quantidade_disponivel: r.available_quantity,
        }));
        fonte = 'Mercado Livre';
      }
    } catch (e) {
      console.warn('[planilha/buscar-preco] ML falhou:', e.message);
    }

    // Tentativa 2: Google Shopping via SerpApi (se ML vazio e chave configurada)
    if (results.length === 0 && process.env.SERPAPI_KEY) {
      for (const termo of [termoSimplificado, termoSimplificado.split(' ').slice(0, 2).join(' ')]) {
        if (results.length > 0) break;
        try {
          const { getJson } = require('serpapi');
          const dados = await new Promise((resolve, reject) => {
            getJson({
              engine: 'google_shopping', q: termo,
              gl: 'br', hl: 'pt', location: 'Brazil',
              api_key: process.env.SERPAPI_KEY,
            }, (d) => d.error ? reject(new Error(d.error)) : resolve(d));
          });
          const itens = (dados.shopping_results || []).slice(0, 5)
            .map(r => ({
              titulo: r.title,
              preco: r.extracted_price || null,
              link: r.link || r.product_link,
              thumbnail: r.thumbnail,
              vendedor: r.source || 'Google Shopping',
              fonte: r.source || 'Google Shopping',
            }))
            .filter(r => r.preco);
          if (itens.length > 0) { results = itens; fonte = 'Google Shopping'; }
        } catch (e) {
          console.warn('[planilha/buscar-preco] SerpApi falhou:', e.message);
        }
      }
    }

    if (item_id && results.length > 0) {
      const melhor = results[0];
      await db.query(
        `UPDATE proposta_itens SET ml_preco_encontrado=$1, ml_link=$2, ml_produto_id=$3, atualizado_em=NOW() WHERE id=$4`,
        [melhor.preco, melhor.link, melhor.id ? String(melhor.id) : null, item_id],
      );
    }

    res.json({ results, fonte, termo_usado: termoSimplificado });
  } catch (err) {
    console.error('[planilha/buscar-preco]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar preços.', detalhe: err.message });
  }
}

// ── GET /api/planilha/planilhas/:id/exportar-csv ─────────────────────────────
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
