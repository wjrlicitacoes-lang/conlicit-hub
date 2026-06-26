const axios = require('axios');
const db    = require('../database/db');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const BRASILAPI_URL = 'https://brasilapi.com.br/api/cnpj/v1';
const CLAUDE_MODEL  = process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5-20251001';

async function chamarClaude(prompt, maxTokens = 1000) {
  const resp = await axios.post(
    ANTHROPIC_URL,
    { model: CLAUDE_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    },
  );
  return resp.data.content?.[0]?.text || '{}';
}

function parseJsonClaude(texto) {
  try {
    return JSON.parse(texto.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
}

async function buscarCnaeComCache(cnpj) {
  const cnpjLimpo = cnpj.replace(/\D/g, '');

  const { rows: [cache] } = await db.query(
    `SELECT cnaes, razao_social, atualizado_em FROM cnpj_cnae_cache WHERE cnpj = $1`,
    [cnpjLimpo],
  );
  if (cache && (Date.now() - new Date(cache.atualizado_em).getTime()) / 86400000 < 30) {
    return { cnaes: cache.cnaes, razao_social: cache.razao_social };
  }

  const resp = await axios.get(`${BRASILAPI_URL}/${cnpjLimpo}`, { timeout: 8000 });
  const d = resp.data;
  const cnaes = [
    { codigo: d.cnae_fiscal, descricao: d.cnae_fiscal_descricao, principal: true },
    ...(d.cnaes_secundarios || []).map(c => ({ codigo: c.codigo, descricao: c.descricao, principal: false })),
  ];

  await db.query(
    `INSERT INTO cnpj_cnae_cache (cnpj, cnaes, razao_social, atualizado_em)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (cnpj) DO UPDATE SET cnaes = $2, razao_social = $3, atualizado_em = NOW()`,
    [cnpjLimpo, JSON.stringify(cnaes), d.razao_social],
  );

  return { cnaes, razao_social: d.razao_social };
}

// GET /api/contratacoes/cnpj/:cnpj
async function buscarCnae(req, res) {
  try {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14) return res.status(400).json({ erro: 'CNPJ inválido' });
    const resultado = await buscarCnaeComCache(cnpj);
    return res.json({ cnpj, ...resultado, fonte: 'cache-ou-receita' });
  } catch (e) {
    console.error('[contratacoes/cnae] ERRO:', e.message);
    return res.status(500).json({ erro: 'Erro ao buscar CNAE.', detalhe: e.message });
  }
}

// POST /api/contratacoes/processar  — chamado pelo Make.com, auth via x-make-token
async function processar(req, res) {
  if (req.headers['x-make-token'] !== process.env.MAKE_WEBHOOK_TOKEN) {
    return res.status(401).json({ erro: 'Token inválido' });
  }

  const { email_conta, email_assunto, email_corpo, link_original, pdf_texto } = req.body;
  if (!email_corpo && !pdf_texto) {
    return res.status(400).json({ erro: 'Conteúdo do email não enviado.' });
  }

  try {
    const conteudo = ((email_corpo || '') + (pdf_texto ? '\n\n' + pdf_texto : '')).slice(0, 8000);

    // PASSO 1: Extrair dados estruturados com IA
    const promptExtracao = `Você é especialista em licitações públicas brasileiras.

Analise o conteúdo abaixo de um email de contratação direta (dispensa, chamamento, cotação ou similar).

Retorne APENAS um JSON válido, sem explicações, sem markdown:
{"objeto":"descrição clara, máx 150 chars","orgao":"nome do órgão comprador","valor_estimado":0.00,"prazo_resposta":"YYYY-MM-DD ou null","score_geral":7.5,"tipo":"dispensa|chamamento|cotacao|outro"}

Regras: valor_estimado = número puro ou null; prazo_resposta = YYYY-MM-DD ou null; score_geral = 0-10.

CONTEÚDO:
${conteudo}`;

    const textoExtracao = await chamarClaude(promptExtracao, 800);
    const dadosOp = parseJsonClaude(textoExtracao) || {
      objeto: email_assunto || 'Sem objeto identificado',
      score_geral: 5,
    };

    // PASSO 2: Salvar oportunidade
    const { rows: [contratacao] } = await db.query(
      `INSERT INTO contratacoes_diretas
         (email_conta, email_assunto, objeto, orgao, valor_estimado, prazo_resposta,
          score_geral, email_corpo_raw, link_original)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        email_conta || null,
        email_assunto || null,
        dadosOp.objeto || null,
        dadosOp.orgao || null,
        dadosOp.valor_estimado || null,
        dadosOp.prazo_resposta || null,
        dadosOp.score_geral || null,
        conteudo,
        link_original || null,
      ],
    );

    // PASSO 3: Buscar clientes ativos
    const { rows: clientes } = await db.query(
      `SELECT id, nome, cnpj, palavras_chave, segmento FROM clientes WHERE ativo = true`,
    );

    if (!clientes.length) {
      return res.json({ contratacao_id: contratacao.id, matches: [], aviso: 'Nenhum cliente ativo.' });
    }

    // PASSO 4: Buscar CNAEs com cache (falhas silenciosas por cliente)
    const clientesComCnae = await Promise.all(
      clientes.map(async (c) => {
        if (!c.cnpj) return { ...c, cnaes: [] };
        try {
          const { cnaes } = await buscarCnaeComCache(c.cnpj);
          return { ...c, cnaes };
        } catch {
          return { ...c, cnaes: [] };
        }
      }),
    );

    // PASSO 5: Matching com IA
    const listaClientes = clientesComCnae.map(c => {
      const cnaesStr = (c.cnaes || []).slice(0, 5).map(cn => `${cn.codigo} - ${cn.descricao}`).join(', ');
      const kw = Array.isArray(c.palavras_chave) ? c.palavras_chave.join(', ') : (c.palavras_chave || '');
      return `- ID: ${c.id} | Nome: ${c.nome} | CNAEs: ${cnaesStr || 'não disponível'} | Palavras-chave: ${kw || 'não cadastradas'}`;
    }).join('\n');

    const promptMatching = `Você é especialista em licitações públicas brasileiras.

OPORTUNIDADE:
Objeto: ${dadosOp.objeto}
Órgão: ${dadosOp.orgao || 'não identificado'}
Valor: R$ ${dadosOp.valor_estimado || 'não informado'}

CLIENTES:
${listaClientes}

Retorne APENAS um JSON válido, sem explicações, sem markdown:
{"matches":[{"empresa_id":0,"empresa_nome":"Nome","score_fit":87,"motivo":"CNAE 22.29 · palavra embalagem"}]}

Regras: inclua apenas score_fit >= 50; empresa_id deve ser o ID numérico exato da lista; motivo máx 100 chars. Se nenhum: {"matches":[]}`;

    const textoMatching = await chamarClaude(promptMatching, 2000);
    const matches = parseJsonClaude(textoMatching)?.matches || [];

    // PASSO 6: Salvar matches
    if (matches.length > 0) {
      const vals = matches.map((_, i) => {
        const b = i * 5;
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`;
      }).join(',');
      await db.query(
        `INSERT INTO contratacoes_matches (contratacao_id, empresa_id, empresa_nome, score_fit, motivo) VALUES ${vals}`,
        matches.flatMap(m => [contratacao.id, m.empresa_id, m.empresa_nome, m.score_fit, m.motivo]),
      );
    }

    return res.json({
      contratacao_id: contratacao.id,
      objeto: dadosOp.objeto,
      score_geral: dadosOp.score_geral,
      matches_encontrados: matches.length,
      matches,
    });

  } catch (e) {
    console.error('[contratacoes/processar] ERRO:', e.message);
    return res.status(500).json({ erro: 'Erro ao processar oportunidade.', detalhe: e.message });
  }
}

// GET /api/contratacoes/listar
async function listar(req, res) {
  try {
    const dias              = Math.min(parseInt(req.query.dias) || 1, 30);
    const somente_com_match = req.query.com_match === 'true';
    const empresa_id        = req.query.empresa_id ? parseInt(req.query.empresa_id) : null;

    const { rows } = await db.query(
      `SELECT cd.*,
         COALESCE(
           json_agg(cm ORDER BY cm.score_fit DESC) FILTER (WHERE cm.id IS NOT NULL),
           '[]'
         ) AS contratacoes_matches
       FROM contratacoes_diretas cd
       LEFT JOIN contratacoes_matches cm ON cm.contratacao_id = cd.id
       WHERE cd.created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY cd.id
       ORDER BY cd.score_geral DESC NULLS LAST, cd.created_at DESC`,
      [String(dias)],
    );

    let resultado = rows;

    if (empresa_id) {
      resultado = resultado.filter(c =>
        c.contratacoes_matches.some(m => m.empresa_id === empresa_id),
      );
    }
    if (somente_com_match) {
      resultado = resultado.filter(c => c.contratacoes_matches.length > 0);
    }

    const stats = {
      total:        resultado.length,
      com_match:    resultado.filter(c => c.contratacoes_matches.length > 0).length,
      prazo_critico: resultado.filter(c => {
        if (!c.prazo_resposta) return false;
        return (new Date(c.prazo_resposta) - new Date()) / 86400000 <= 3;
      }).length,
      valor_total:  resultado.reduce((acc, c) => acc + (Number(c.valor_estimado) || 0), 0),
    };

    return res.json({ stats, oportunidades: resultado });
  } catch (e) {
    console.error('[contratacoes/listar] ERRO:', e.message);
    return res.status(500).json({ erro: 'Erro ao listar.', detalhe: e.message });
  }
}

// PATCH /api/contratacoes/:id/status
async function atualizarStatus(req, res) {
  const STATUS_VALIDOS = ['novo', 'em_analise', 'notificado', 'descartado'];
  const { status } = req.body;
  if (!STATUS_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  try {
    const { rowCount } = await db.query(
      `UPDATE contratacoes_diretas SET status = $1 WHERE id = $2`,
      [status, req.params.id],
    );
    if (!rowCount) return res.status(404).json({ erro: 'Não encontrado.' });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

module.exports = { processar, listar, atualizarStatus, buscarCnae };
