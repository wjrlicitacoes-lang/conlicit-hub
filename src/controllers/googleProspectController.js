'use strict';
const axios = require('axios');
const db    = require('../database/db');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Queries por nicho (template com {cidade})
const NICHO_QUERIES = {
  'Saúde / Medicamentos': [
    'distribuidora medicamentos licitação {cidade}',
    'distribuidor hospitalar fornecedor SUS {cidade}',
    'farmácia hospitalar pregão público {cidade}',
  ],
  'Limpeza e Conservação': [
    'empresa limpeza conservação licitação {cidade}',
    'conservadora terceirização serviços {cidade} pregão',
    'facilities limpeza fornecedor prefeitura {cidade}',
  ],
  'Obras / Engenharia': [
    'construtora licitação obras {cidade}',
    'empresa engenharia civil pregão público {cidade}',
    'construtora fornecedor prefeitura {cidade} PNCP',
  ],
  'TI / Software': [
    'empresa TI software licitação {cidade}',
    'consultoria tecnologia governo {cidade} pregão',
    'fornecedor sistema informática prefeitura {cidade}',
  ],
  'Segurança / Vigilância': [
    'empresa vigilância segurança patrimonial licitação {cidade}',
    'vigilância armada pregão {cidade}',
    'empresa segurança fornecedor governo {cidade}',
  ],
  'Transporte / Frota': [
    'empresa transporte locação veículos licitação {cidade}',
    'transportadora fretamento {cidade} pregão',
    'locadora frota terceirização {cidade}',
  ],
  'Alimentação / Merenda': [
    'fornecedor merenda escolar PNAE {cidade}',
    'empresa alimentação refeições coletivas licitação {cidade}',
    'distribuidora gêneros alimentícios pregão {cidade}',
  ],
  'EPI / Equipamentos': [
    'distribuidora EPI licitação {cidade}',
    'equipamento proteção individual pregão {cidade}',
    'fornecedor EPI uniforme governo {cidade}',
  ],
  'Manutenção Predial': [
    'empresa manutenção predial climatização licitação {cidade}',
    'manutenção ar condicionado elevadores pregão {cidade}',
    'facilities manutenção fornecedor prefeitura {cidade}',
  ],
  'Saneamento / Ambiental': [
    'empresa resíduos especiais saneamento licitação {cidade}',
    'gestão ambiental resíduos pregão {cidade}',
    'coleta resíduos hospitalares fornecedor {cidade}',
  ],
};

function buildQueries(nicho, cidade) {
  const templates = NICHO_QUERIES[nicho] || [`empresa ${nicho} licitação ${cidade}`, `fornecedor ${nicho} pregão ${cidade}`];
  return templates.map(q => q.replace(/\{cidade\}/g, cidade));
}

// Busca via SerpAPI
async function searchViaSerpAPI(query, page = 1) {
  const { data } = await axios.get('https://serpapi.com/search', {
    params: {
      api_key: process.env.SERPAPI_KEY,
      engine:  'google',
      q:       query,
      hl:      'pt',
      gl:      'br',
      num:     10,
      start:   (page - 1) * 10,
    },
    timeout: 15000,
  });
  return (data.organic_results || []).map(r => ({
    titulo:  r.title  || '',
    link:    r.link   || '',
    snippet: r.snippet || '',
    displayed_link: r.displayed_link || '',
  }));
}

// Busca via Google Custom Search JSON API
async function searchViaGoogleCSE(query, page = 1) {
  const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
    params: {
      key: process.env.GOOGLE_CSE_KEY,
      cx:  process.env.GOOGLE_CSE_ID,
      q:   query,
      lr:  'lang_pt',
      num: 10,
      start: (page - 1) * 10 + 1,
    },
    timeout: 15000,
  });
  return (data.items || []).map(r => ({
    titulo:  r.title   || '',
    link:    r.link    || '',
    snippet: r.snippet || '',
    displayed_link: r.displayLink || '',
  }));
}

// Extração de dados via Claude Haiku
async function extrairDadosComIA(resultados, nicho, cidade) {
  if (!process.env.ANTHROPIC_API_KEY || !resultados.length) return [];

  const lista = resultados.map((r, i) =>
    `${i + 1}. Título: ${r.titulo}\nURL: ${r.link}\nSnippet: ${r.snippet}`
  ).join('\n\n');

  try {
    const { data } = await axios.post(
      ANTHROPIC_URL,
      {
        model:      process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5',
        max_tokens: 1200,
        system: 'Você é um assistente de prospecção B2B. Analise os resultados de busca do Google ' +
                'e retorne APENAS um array JSON, sem texto extra: ' +
                '[{"nome_empresa":"string","site":"url","telefone":"string ou null","email":"string ou null",' +
                '"endereco":"string ou null","relevancia":0-10}]. ' +
                'relevancia: 10=empresa claramente do nicho que faz licitações, 0=irrelevante. ' +
                'Se não for uma empresa real do nicho, relevancia <= 3.',
        messages: [{
          role: 'user',
          content: `Nicho: ${nicho}\nCidade: ${cidade}\n\nResultados de busca:\n\n${lista}`,
        }],
      },
      {
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type':      'application/json',
        },
        timeout: 20000,
      },
    );

    const raw   = data.content?.[0]?.text || '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch (e) {
    console.error('[GoogleProspect] extrairDados IA:', e.message);
    return [];
  }
}

// POST /api/prospects/buscar-google
async function buscarGoogle(req, res) {
  const { nicho, cidade = 'Belo Horizonte', raio, pagina = 1 } = req.body;
  if (!nicho) return res.status(400).json({ erro: 'nicho é obrigatório' });

  const queries = buildQueries(nicho, cidade);

  // Modo fallback: sem chave de API — retorna URLs de busca manual
  const temSerpAPI   = !!process.env.SERPAPI_KEY;
  const temGoogleCSE = !!(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID);

  if (!temSerpAPI && !temGoogleCSE) {
    const links = queries.map(q => ({
      query: q,
      url_google: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    }));
    return res.json({
      modo: 'manual',
      mensagem: 'Configure SERPAPI_KEY ou GOOGLE_CSE_KEY+GOOGLE_CSE_ID para busca automática.',
      queries: links,
      resultados: [],
    });
  }

  const resultados = [];
  const erros      = [];

  for (const query of queries.slice(0, 2)) {
    try {
      let raw = [];
      if (temSerpAPI)   raw = await searchViaSerpAPI(query, pagina);
      else              raw = await searchViaGoogleCSE(query, pagina);

      const dados = await extrairDadosComIA(raw, nicho, cidade);

      for (let i = 0; i < raw.length; i++) {
        const item = dados[i] || {};
        const empresa = {
          nome_empresa: item.nome_empresa || raw[i].titulo,
          site:         item.site         || raw[i].link,
          telefone:     item.telefone     || null,
          email:        item.email        || null,
          endereco:     item.endereco     || null,
          relevancia:   item.relevancia   ?? 5,
          snippet:      raw[i].snippet,
          nicho,
          cidade,
          query_usada: query,
        };

        if (empresa.relevancia >= 4) {
          resultados.push(empresa);
          // Salvar na tabela
          await db.query(
            `INSERT INTO google_prospects (nome_empresa, site, telefone, email, endereco, nicho, cidade, query_usada, relevancia, snippet)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [empresa.nome_empresa, empresa.site, empresa.telefone, empresa.email,
             empresa.endereco, nicho, cidade, query, empresa.relevancia, empresa.snippet],
          ).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[GoogleProspect] buscarGoogle:', e.message);
      erros.push({ query, erro: e.message });
    }
  }

  // Ordenar por relevância
  resultados.sort((a, b) => (b.relevancia || 0) - (a.relevancia || 0));

  return res.json({ modo: temSerpAPI ? 'serpapi' : 'google_cse', resultados, erros });
}

// GET /api/prospects/buscar-google/historico
async function listarHistoricoGoogle(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT nicho, cidade, COUNT(*) AS total,
              SUM(CASE WHEN status='prospect_criado' THEN 1 ELSE 0 END) AS convertidos,
              MIN(created_at) AS primeira_busca, MAX(created_at) AS ultima_busca
       FROM google_prospects
       GROUP BY nicho, cidade
       ORDER BY ultima_busca DESC
       LIMIT 30`,
    );
    return res.json({ historico: rows });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

// GET /api/prospects/buscar-google/resultados
async function listarResultadosGoogle(req, res) {
  const { nicho, cidade, status = 'encontrado' } = req.query;
  try {
    const conds = ['1=1'];
    const params = [];
    if (nicho)  { conds.push(`nicho = $${params.length+1}`);  params.push(nicho); }
    if (cidade) { conds.push(`cidade = $${params.length+1}`); params.push(cidade); }
    if (status) { conds.push(`status = $${params.length+1}`); params.push(status); }

    const { rows } = await db.query(
      `SELECT * FROM google_prospects WHERE ${conds.join(' AND ')} ORDER BY relevancia DESC, created_at DESC LIMIT 100`,
      params,
    );
    return res.json({ resultados: rows });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

// POST /api/prospects/buscar-google/:id/prospect
async function adicionarComoProspect(req, res) {
  const { id } = req.params;
  const { nome_contato, email, whatsapp, obs } = req.body;
  try {
    const { rows: [gp] } = await db.query(`SELECT * FROM google_prospects WHERE id=$1`, [parseInt(id, 10)]);
    if (!gp) return res.status(404).json({ erro: 'Empresa não encontrada' });

    const { rows: [p] } = await db.query(
      `INSERT INTO prospects
         (nome, empresa, email, whatsapp, segmento, obs, origem, status, canal_origem, empresa_url)
       VALUES ($1,$2,$3,$4,$5,$6,'google','novo_lead','google',$7) RETURNING *`,
      [
        nome_contato || gp.nome_empresa,
        gp.nome_empresa,
        email || gp.email || null,
        whatsapp || gp.telefone || null,
        gp.nicho || null,
        obs || `Encontrado via busca Google: ${gp.query_usada}`,
        gp.site || null,
      ],
    );

    await db.query(
      `UPDATE google_prospects SET status='prospect_criado', prospect_id=$1 WHERE id=$2`,
      [p.id, gp.id],
    );

    return res.status(201).json({ prospect: p });
  } catch (e) {
    console.error('[GoogleProspect] adicionarComoProspect:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

// GET /api/prospects/social-templates
async function listarSocialTemplates(req, res) {
  const { canal, nicho, tipo } = req.query;
  const conds  = ['1=1'];
  const params = [];
  if (canal) { conds.push(`canal = $${params.length+1}`);  params.push(canal); }
  if (nicho) { conds.push(`nicho = $${params.length+1}`);  params.push(nicho); }
  if (tipo)  { conds.push(`tipo  = $${params.length+1}`);  params.push(tipo); }

  try {
    const { rows } = await db.query(
      `SELECT * FROM social_templates WHERE ${conds.join(' AND ')} ORDER BY nicho, tipo, id`,
      params,
    );
    return res.json({ templates: rows });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

// PATCH /api/prospects/social-templates/:id
async function atualizarTemplate(req, res) {
  const { id } = req.params;
  const { status, publicado_em, resultado } = req.body;
  try {
    await db.query(
      `UPDATE social_templates SET
         status=COALESCE($1,status), publicado_em=COALESCE($2,publicado_em),
         resultado=COALESCE($3,resultado)
       WHERE id=$4`,
      [status || null, publicado_em || null, resultado || null, parseInt(id, 10)],
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

// GET /api/prospects/multicanal/kpis
async function kpisMulticanal(req, res) {
  try {
    const { rows: porCanal } = await db.query(
      `SELECT canal_origem, COUNT(*) AS total,
              SUM(CASE WHEN status IN ('convertido','fechado') THEN 1 ELSE 0 END) AS convertidos,
              SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) AS esta_semana
       FROM prospects
       GROUP BY canal_origem
       ORDER BY total DESC`,
    );

    const { rows: recentes } = await db.query(
      `SELECT id, nome, empresa, canal_origem, status, created_at
       FROM prospects
       ORDER BY created_at DESC
       LIMIT 20`,
    );

    return res.json({ por_canal: porCanal, recentes });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

module.exports = {
  buscarGoogle, listarHistoricoGoogle, listarResultadosGoogle,
  adicionarComoProspect, listarSocialTemplates, atualizarTemplate,
  kpisMulticanal,
};
