const db    = require('../database/db');
const axios = require('axios');
const multer = require('multer');
const XLSX   = require('xlsx');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'wjrlicitacoes@gmail.com';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || '';
const FROM_EMAIL     = process.env.BOLETIM_FROM_EMAIL || 'onboarding@resend.dev';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function registrarEvento(prospect_id, tipo, descricao, dados = null) {
  await db.query(
    `INSERT INTO prospects_eventos (prospect_id, tipo, descricao, dados) VALUES ($1,$2,$3,$4)`,
    [prospect_id, tipo, descricao, dados ? JSON.stringify(dados) : null],
  );
}

async function notificarAdmin(prospect) {
  const msg = `🎯 Novo lead Conlicit!\n\n` +
    `*${prospect.nome}* — ${prospect.empresa || '—'}\n` +
    `📧 ${prospect.email || '—'}\n` +
    `📱 ${prospect.whatsapp || '—'}\n` +
    `🏷️ Segmento: ${prospect.segmento || '—'}\n` +
    `📄 Edital: ${prospect.edital || '—'}\n` +
    `🌐 Origem: ${prospect.origem}`;

  // WhatsApp
  if (ADMIN_WHATSAPP && process.env.ZAPI_INSTANCE) {
    const { enviarTexto } = require('../services/zapiService');
    enviarTexto(ADMIN_WHATSAPP, msg).catch(() => {});
  }

  // Email
  if (process.env.RESEND_API_KEY) {
    axios.post('https://api.resend.com/emails', {
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `Novo lead: ${prospect.nome} — ${prospect.empresa || prospect.segmento || 'Conlicit'}`,
      html: `<pre style="font-family:sans-serif">${msg.replace(/\n/g,'<br>')}</pre>`,
    }, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    }).catch(() => {});
  }
}

// ── CRUD autenticado ──────────────────────────────────────────────────────────

async function listar(req, res) {
  const { status, status_contato, segmento, nicho, data_de, data_ate, origem, q,
          responsavel_id, page, limit } = req.query;
  const conds = [];
  const vals  = [];

  if (status)          { vals.push(status);          conds.push(`p.status = $${vals.length}`); }
  if (status_contato)  { vals.push(status_contato);  conds.push(`p.status_contato = $${vals.length}`); }
  if (segmento)        { vals.push(segmento);         conds.push(`p.segmento = $${vals.length}`); }
  if (nicho)           { vals.push(`%${nicho}%`);     conds.push(`p.nicho ILIKE $${vals.length}`); }
  if (origem)          { vals.push(origem);            conds.push(`p.origem = $${vals.length}`); }
  if (responsavel_id)  { vals.push(responsavel_id);   conds.push(`p.responsavel_id = $${vals.length}`); }
  if (data_de)  { vals.push(data_de);  conds.push(`p.created_at >= $${vals.length}`); }
  if (data_ate) { vals.push(data_ate); conds.push(`p.created_at <= $${vals.length} + interval '1 day'`); }
  if (q) {
    vals.push(`%${q}%`);
    const n = vals.length;
    conds.push(`(p.nome ILIKE $${n} OR p.empresa ILIKE $${n} OR p.nome_empresa ILIKE $${n} OR p.email ILIKE $${n} OR p.cnpj ILIKE $${n})`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const lim   = Math.min(parseInt(limit) || 200, 500);
  const off   = ((parseInt(page) || 1) - 1) * lim;

  try {
    const { rows } = await db.query(
      `SELECT p.*, ae.status AS analise_status,
              u.nome AS responsavel_nome_usuario
         FROM prospects p
         LEFT JOIN analises_edson ae ON ae.id = p.analise_edson_id
         LEFT JOIN usuarios u ON u.id = p.responsavel_id
         ${where}
         ORDER BY p.created_at DESC
         LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
      [...vals, lim, off],
    );
    const { rows: [{ n }] } = await db.query(
      `SELECT COUNT(*) AS n FROM prospects p ${where}`, vals,
    );
    return res.json({ total: parseInt(n), dados: rows });
  } catch (e) {
    console.error('[Prospects] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criar(req, res) {
  const {
    nome, email, whatsapp, empresa, segmento, status, notas, responsavel,
    indicado_por, edital, obs, origem,
    cnpj, cargo, cidade, estado, valor_potencial, data_proximo_contato, canal_origem,
  } = req.body ?? {};
  if (!nome?.trim()) return res.status(400).json({ erro: 'nome é obrigatório' });
  try {
    const { rows: [p] } = await db.query(
      `INSERT INTO prospects
         (nome, email, whatsapp, empresa, segmento, status, notas, responsavel,
          indicado_por, edital, obs, origem,
          cnpj, cargo, cidade, estado, valor_potencial, data_proximo_contato, canal_origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [
        nome.trim(), email || null, whatsapp || null, empresa || null,
        segmento || null, status || 'novo_lead', notas || null,
        responsavel || null, indicado_por || null,
        edital || null, obs || null, origem || canal_origem || 'manual',
        cnpj || null, cargo || null, cidade || null, estado || null,
        valor_potencial ? parseFloat(valor_potencial) : null,
        data_proximo_contato || null, canal_origem || 'manual',
      ],
    );
    await registrarEvento(p.id, 'lead_criado', `Lead criado manualmente por ${req.usuario.email}`);
    return res.status(201).json(p);
  } catch (e) {
    console.error('[Prospects] criar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizar(req, res) {
  const { id } = req.params;
  const {
    nome, email, whatsapp, empresa, segmento, status, notas, responsavel,
    indicado_por, edital, obs, origem, brevo_email_id,
    cnpj, cargo, cidade, estado, valor_potencial, data_proximo_contato, canal_origem,
  } = req.body ?? {};
  try {
    const { rows: [antes] } = await db.query(`SELECT status FROM prospects WHERE id=$1`, [id]);
    if (!antes) return res.status(404).json({ erro: 'Prospect não encontrado' });

    const { rows: [p] } = await db.query(
      `UPDATE prospects SET
         nome=$1, email=$2, whatsapp=$3, empresa=$4, segmento=$5,
         status=$6, notas=$7, responsavel=$8, indicado_por=$9,
         edital=$10, obs=$11, origem=COALESCE($12, origem),
         brevo_email_id=COALESCE($13, brevo_email_id),
         cnpj=COALESCE($15, cnpj), cargo=COALESCE($16, cargo),
         cidade=COALESCE($17, cidade), estado=COALESCE($18, estado),
         valor_potencial=COALESCE(NULLIF($19,'')::numeric, valor_potencial),
         data_proximo_contato=COALESCE(NULLIF($20,'')::date, data_proximo_contato),
         canal_origem=COALESCE($21, canal_origem),
         updated_at=NOW()
       WHERE id=$14 RETURNING *`,
      [
        nome, email || null, whatsapp || null, empresa || null, segmento || null,
        status || antes.status, notas || null, responsavel || null,
        indicado_por || null, edital || null, obs || null,
        origem || null, brevo_email_id || null, id,
        cnpj || null, cargo || null, cidade || null, estado || null,
        valor_potencial ?? null, data_proximo_contato ?? null, canal_origem || null,
      ],
    );

    if (status && status !== antes.status) {
      await registrarEvento(p.id, 'status_alterado',
        `Status alterado de "${antes.status}" para "${status}" por ${req.usuario.email}`);
    }

    return res.json(p);
  } catch (e) {
    console.error('[Prospects] atualizar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function obterPorId(req, res) {
  const { id } = req.params;
  try {
    const { rows: [p] } = await db.query(`SELECT * FROM prospects WHERE id=$1`, [id]);
    if (!p) return res.status(404).json({ erro: 'Prospect não encontrado' });
    return res.json(p);
  } catch (e) {
    console.error('[Prospects] obterPorId:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function remover(req, res) {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query(`DELETE FROM prospects WHERE id=$1`, [id]);
    if (!rowCount) return res.status(404).json({ erro: 'Prospect não encontrado' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Prospects] remover:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function eventos(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM prospects_eventos WHERE prospect_id=$1 ORDER BY created_at ASC`,
      [id],
    );
    return res.json({ dados: rows });
  } catch (e) {
    console.error('[Prospects] eventos:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function analisar(req, res) {
  const { id } = req.params;
  try {
    const { rows: [p] } = await db.query(`SELECT * FROM prospects WHERE id=$1`, [id]);
    if (!p) return res.status(404).json({ erro: 'Prospect não encontrado' });
    if (!p.edital?.trim()) return res.status(400).json({ erro: 'Prospect não tem edital informado' });

    // Cria análise avulsa no Edson
    const ref = `Prospect: ${p.nome} — ${p.empresa || p.segmento || 'Sem empresa'} | ${p.edital}`;
    const { rows: [analise] } = await db.query(
      `INSERT INTO analises_edson (referencia, status)
       VALUES ($1, 'aguardando_pdf') RETURNING id`,
      [ref],
    );

    await db.query(
      `UPDATE prospects SET analise_edson_id=$1, status='resumo_enviado', updated_at=NOW() WHERE id=$2`,
      [analise.id, id],
    );

    await registrarEvento(p.id, 'analise_solicitada',
      `Análise Edson criada (#${analise.id}) para edital: ${p.edital}`);

    return res.json({ ok: true, analise_id: analise.id, mensagem: 'Análise criada. Acesse o Edson para fazer upload do PDF.' });
  } catch (e) {
    console.error('[Prospects] analisar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Análise automática de edital para prospect (background) ─────────────────

async function processarAnaliseProspect(prospect) {
  const { analisarAvulso } = require('../services/edsonService');
  const { readFile } = require('fs').promises;
  const path = require('path');

  const referencia = `Prospect #${prospect.id}: ${prospect.nome} — ${prospect.empresa || prospect.segmento || ''} | ${prospect.edital}`;

  // Cria registro em analises_edson
  const { rows: [analise] } = await db.query(
    `INSERT INTO analises_edson (referencia, status) VALUES ($1, 'aguardando_pdf') RETURNING id`,
    [referencia],
  );

  await db.query(
    `UPDATE prospects SET analise_edson_id=$1, updated_at=NOW() WHERE id=$2`,
    [analise.id, prospect.id],
  );

  await registrarEvento(prospect.id, 'analise_solicitada',
    `Análise Edson criada (#${analise.id}) via landing page`);

  // TODO: conectar busca PNCP por número de edital quando número de controle for passado
  await analisarAvulso(analise.id, {
    referencia,           // número/link do edital passado via referencia
    palavrasChave: prospect.segmento || null,
    modo: 'reuniao',
  });

  // Busca resultado salvo pela análise
  const { rows: [resultado] } = await db.query(
    `SELECT * FROM analises_edson WHERE id=$1`,
    [analise.id],
  );

  if (resultado?.status !== 'pronto' || !prospect.email || !process.env.RESEND_API_KEY) return;

  // Lê e preenche template de email
  const templatePath = path.join(__dirname, '../../public/emails/email-resumo-prospect.html');
  let html = await readFile(templatePath, 'utf8');

  const habJson = Array.isArray(resultado.habilitacao) ? resultado.habilitacao
    : (() => { try { return JSON.parse(resultado.habilitacao || '[]'); } catch { return []; } })();
  const clausulasJson = Array.isArray(resultado.clausulas_restritivas) ? resultado.clausulas_restritivas
    : (() => { try { return JSON.parse(resultado.clausulas_restritivas || '[]'); } catch { return []; } })();

  const habText = habJson.map(h =>
    `${h.categoria}: ${(h.documentos || []).map(d => d.nome).join(', ')}`
  ).join('<br>') || '—';
  const docsText = habJson.flatMap(h => (h.documentos || []).map(d => d.nome)).join(', ') || '—';
  const pontosText = clausulasJson.length
    ? clausulasJson.map(c => `⚠️ ${c.clausula}`).join('<br>')
    : 'Nenhum ponto crítico identificado.';
  const valorFmt = resultado.valor_estimado
    ? `R$ ${Number(resultado.valor_estimado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : '—';

  html = html
    .replace(/\{\{NOME\}\}/g,            prospect.nome || '')
    .replace(/\{\{EMPRESA\}\}/g,          prospect.empresa || 'sua empresa')
    .replace(/\{\{ORGAO\}\}/g,            resultado.orgao || '—')
    .replace(/\{\{OBJETO\}\}/g,           prospect.edital || '—')
    .replace(/\{\{VALOR\}\}/g,            valorFmt)
    .replace(/\{\{DATA_ABERTURA\}\}/g,    resultado.data_abertura || '—')
    .replace(/\{\{HABILITACAO\}\}/g,      habText)
    .replace(/\{\{DOCUMENTOS\}\}/g,       docsText)
    .replace(/\{\{PONTOS_ATENCAO\}\}/g,   pontosText)
    .replace(/\{\{RESUMO_EXECUTIVO\}\}/g, resultado.resumo_executivo || '—');

  await axios.post('https://api.resend.com/emails', {
    from: process.env.BOLETIM_FROM_EMAIL || 'onboarding@resend.dev',
    to: prospect.email,
    subject: `📋 Resumo do edital que você enviou — Conlicit`,
    html,
  }, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });

  await registrarEvento(prospect.id, 'resumo_enviado',
    `Resumo do edital enviado por email para ${prospect.email}`);
  await db.query(
    `UPDATE prospects SET status='resumo_enviado', updated_at=NOW() WHERE id=$1`,
    [prospect.id],
  );

  // WhatsApp de confirmação de envio
  if (prospect.whatsapp && process.env.ZAPI_INSTANCE) {
    const { enviarTexto } = require('../services/zapiService');
    const msg =
      `Olá ${prospect.nome}! 👋\n\n` +
      `Acabei de enviar para ${prospect.email} o resumo do edital que você solicitou.\n\n` +
      `Se quiser conversar sobre o resultado, é só responder aqui.\n\n` +
      `— Sabrine | Conlicit`;
    enviarTexto(prospect.whatsapp, msg).catch(() => {});
  }
}

// ── Endpoint público — landing page ──────────────────────────────────────────

async function receberLanding(req, res) {
  const { nome, empresa, email, whatsapp, segmento, tipo_edital, edital, obs, origem } = req.body ?? {};
  if (!nome?.trim()) return res.status(400).json({ erro: 'nome é obrigatório' });

  try {
    // Verifica se já existe pelo email para evitar duplicata
    let prospect;
    if (email) {
      const { rows } = await db.query(
        `SELECT * FROM prospects WHERE email=$1 ORDER BY created_at DESC LIMIT 1`, [email],
      );
      prospect = rows[0];
    }

    if (prospect) {
      // Atualiza lead existente
      const { rows: [p] } = await db.query(
        `UPDATE prospects SET
           empresa=COALESCE($1, empresa), whatsapp=COALESCE($2, whatsapp),
           segmento=COALESCE($3, segmento), edital=COALESCE($4, edital),
           obs=COALESCE($5, obs), formulario_preenchido=TRUE,
           status='novo_lead', updated_at=NOW()
         WHERE id=$6 RETURNING *`,
        [empresa || null, whatsapp || null, segmento || null, edital || null, obs || null, prospect.id],
      );
      await registrarEvento(p.id, 'formulario_preenchido',
        `Formulário de análise preenchido via landing page (edital: ${edital || '—'})`);
      prospect = p;
    } else {
      // Cria novo lead
      const { rows: [p] } = await db.query(
        `INSERT INTO prospects
           (nome, empresa, email, whatsapp, segmento, edital, obs,
            origem, status, formulario_preenchido)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'novo_lead',TRUE) RETURNING *`,
        [
          nome.trim(), empresa || null, email || null, whatsapp || null,
          segmento || null, edital || null, obs || null,
          origem || 'landing_page',
        ],
      );
      await registrarEvento(p.id, 'lead_criado',
        `Lead criado via landing page (${origem || 'landing_page'})`);
      await registrarEvento(p.id, 'formulario_preenchido',
        `Formulário de análise preenchido (edital: ${edital || '—'})`);
      prospect = p;
    }

    notificarAdmin(prospect);
    syncBrevoContact(prospect).catch(() => {});
    if (prospect.edital?.trim()) {
      processarAnaliseProspect(prospect).catch(e =>
        console.error('[Prospects] processarAnaliseProspect:', e.message),
      );
    }
    return res.status(201).json({ ok: true, id: prospect.id });
  } catch (e) {
    console.error('[Prospects] receberLanding:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Sync de contato no Brevo ─────────────────────────────────────────────────

async function syncBrevoContact(prospect) {
  const apiKey  = process.env.BREVO_API_KEY;
  const listId  = parseInt(process.env.BREVO_LIST_ID || '0');
  if (!apiKey || !prospect.email) return;

  try {
    const payload = {
      email:          prospect.email,
      attributes:     { NOME: prospect.nome || '', EMPRESA: prospect.empresa || '', SEGMENTO: prospect.segmento || '' },
      listIds:        listId ? [listId] : [],
      updateEnabled:  true,
    };

    const { data } = await axios.post('https://api.brevo.com/v3/contacts', payload, {
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    const contactId = data?.id ? String(data.id) : null;
    if (contactId) {
      await db.query(
        `UPDATE prospects SET brevo_contact_id=$1, updated_at=NOW() WHERE id=$2`,
        [contactId, prospect.id],
      );
      await registrarEvento(prospect.id, 'brevo_sync',
        `Contato sincronizado no Brevo (id: ${contactId})`);
    }
  } catch (e) {
    console.error('[Prospects] syncBrevoContact:', e.response?.data?.message || e.message);
  }
}

// ── Webhook Brevo ─────────────────────────────────────────────────────────────

async function webhookBrevo(req, res) {
  // Brevo pode enviar array ou objeto único
  const eventos = Array.isArray(req.body) ? req.body : [req.body];

  const mapaStatus = { sent: 'enviado', delivered: 'enviado', opened: 'aberto', clicked: 'clicado' };

  for (const ev of eventos) {
    const email = ev.email || ev['email'];
    const tipo  = ev.event || ev['event'];
    if (!email || !tipo) continue;

    const novoStatus = mapaStatus[tipo];
    if (!novoStatus) continue;

    try {
      const { rows } = await db.query(
        `SELECT id, brevo_status FROM prospects WHERE email=$1 ORDER BY created_at DESC LIMIT 1`,
        [email],
      );
      if (!rows.length) continue;
      const p = rows[0];

      // Só avança status (nunca regride: clicado > aberto > enviado)
      const ordem = ['enviado', 'aberto', 'clicado'];
      const atualIdx = ordem.indexOf(p.brevo_status || '');
      const novoIdx  = ordem.indexOf(novoStatus);
      if (novoIdx <= atualIdx) continue;

      await db.query(
        `UPDATE prospects SET brevo_status=$1, brevo_status_at=NOW(),
           brevo_email_id=COALESCE($2, brevo_email_id), updated_at=NOW()
         WHERE id=$3`,
        [novoStatus, ev['message-id'] || ev.messageId || null, p.id],
      );
      await registrarEvento(p.id, `email_${novoStatus}`,
        `Email ${novoStatus} pelo Brevo`);
    } catch (e) {
      console.error('[Prospects] webhookBrevo:', e.message);
    }
  }

  return res.json({ ok: true });
}

// ── Interações ────────────────────────────────────────────────────────────────

async function registrarInteracao(req, res) {
  const { id } = req.params;
  const { tipo, descricao } = req.body ?? {};
  if (!tipo || !descricao) return res.status(400).json({ erro: 'tipo e descricao são obrigatórios' });
  try {
    const { rows: [p] } = await db.query(
      `SELECT historico_interacoes, numero_interacoes FROM prospects WHERE id=$1`, [id],
    );
    if (!p) return res.status(404).json({ erro: 'Prospect não encontrado' });

    const historico = Array.isArray(p.historico_interacoes) ? p.historico_interacoes : [];
    historico.unshift({
      id:         Date.now(),
      tipo,
      descricao,
      usuario:    req.usuario?.nome || req.usuario?.email || 'Sistema',
      created_at: new Date().toISOString(),
    });

    await db.query(
      `UPDATE prospects SET
         historico_interacoes = $1,
         numero_interacoes    = $2,
         ultimo_contato       = NOW(),
         updated_at           = NOW()
       WHERE id=$3`,
      [JSON.stringify(historico), (p.numero_interacoes || 0) + 1, id],
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Prospects] registrarInteracao:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function followup(req, res) {
  const hoje = new Date().toISOString().split('T')[0];
  try {
    const { rows } = await db.query(
      `SELECT * FROM prospects
       WHERE data_proximo_contato <= $1
         AND status NOT IN ('convertido','perdido')
       ORDER BY data_proximo_contato ASC`,
      [hoje],
    );
    return res.json(rows);
  } catch (e) {
    console.error('[Prospects] followup:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function kpis(req, res) {
  const hoje = new Date().toISOString().split('T')[0];
  try {
    const { rows } = await db.query(
      `SELECT status, valor_potencial, canal_origem FROM prospects`,
    );
    const { rows: fu } = await db.query(
      `SELECT count(*) FROM prospects
       WHERE data_proximo_contato <= $1 AND status NOT IN ('convertido','perdido')`,
      [hoje],
    );

    const funil       = rows.filter(p => !['convertido','perdido'].includes(p.status));
    const convertidos = rows.filter(p => p.status === 'convertido');
    const por_status  = rows.reduce((acc, p) => { acc[p.status]  = (acc[p.status]  || 0) + 1; return acc; }, {});
    const por_canal   = rows.reduce((acc, p) => { const c = p.canal_origem || 'manual'; acc[c] = (acc[c] || 0) + 1; return acc; }, {});

    return res.json({
      total:               rows.length,
      funil:               funil.length,
      valor_pipeline:      funil.reduce((s, p) => s + (parseFloat(p.valor_potencial) || 0), 0),
      valor_ganho:         convertidos.reduce((s, p) => s + (parseFloat(p.valor_potencial) || 0), 0),
      taxa_conversao:      rows.length > 0 ? ((convertidos.length / rows.length) * 100).toFixed(1) : '0.0',
      por_status,
      por_canal,
      follow_ups_vencidos: parseInt(fu[0].count),
    });
  } catch (e) {
    console.error('[Prospects] kpis:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Importação por planilha ────────────────────────────────────────────────────

function normalizarChave(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-\/\\.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .trim();
}

function mapearColunas(row) {
  const mapa = {};
  for (const [key, val] of Object.entries(row)) {
    const k = normalizarChave(key);
    if (k) mapa[k] = String(val ?? '').trim();
  }

  const get = (...candidates) => {
    for (const c of candidates) {
      const cn = normalizarChave(c);
      // Busca exata
      if (mapa[cn]) return mapa[cn];
      // Busca parcial: a chave contém o candidato OU candidato contém a chave
      const found = Object.keys(mapa).find(k => (k.includes(cn) || cn.includes(k)) && k.length >= 3);
      if (found && mapa[found]) return mapa[found];
    }
    return '';
  };

  return {
    nome_empresa: get(
      'nome', 'empresa', 'nome_empresa', 'razao_social', 'razao',
      'company', 'name', 'nome_fantasia', 'fantasia', 'cliente',
      'estabelecimento', 'negocio', 'razao_social',
    ),
    email: get(
      'email', 'e_mail', 'email_contato', 'email_empresa',
      'correio', 'mail', 'contato_email',
    ),
    telefone: get(
      'telefone', 'tel', 'celular', 'whatsapp', 'fone',
      'phone', 'contato', 'telefone_contato',
      'cel', 'mobile', 'zap',
    ),
    nicho: get(
      'nicho', 'segmento', 'setor', 'ramo', 'area',
      'atividade', 'cnae', 'categoria', 'tipo', 'mercado',
      'sector', 'industry',
    ),
    cnpj: get(
      'cnpj', 'cnpj_cpf', 'documento', 'doc', 'cadastro',
      'inscricao', 'registro',
    ),
    responsavel_nome: get(
      'responsavel', 'nome_contato', 'pessoa',
      'representante', 'socio', 'dono', 'proprietario',
      'contact', 'owner', 'nome_responsavel',
    ),
    responsavel_cargo: get(
      'cargo', 'funcao', 'titulo', 'role', 'position',
      'funcao_responsavel', 'cargo_responsavel',
    ),
    cidade: get('cidade', 'municipio', 'city', 'localidade'),
    uf:     get('uf', 'estado', 'state', 'sigla_estado'),
  };
}

// Valida se um valor parece um número sequencial (lixo de importação)
function pareceNumeroSequencial(val) {
  if (!val) return false;
  return /^\d+$/.test(String(val).trim()) || /^n[º°]?$/i.test(String(val).trim());
}

// Valida se o email parece real
function emailParece(val) {
  return val && val.includes('@') && val.includes('.');
}

async function importarPlanilha(req, res) {
  if (!req.file) return res.status(400).json({ erro: 'Arquivo não enviado' });

  const modo = req.query.modo || 'confirmar'; // 'preview' ou 'confirmar'

  try {
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length > 0) {
      console.log('[IMPORT] Colunas encontradas:', Object.keys(rows[0]));
      console.log('[IMPORT] Primeira linha raw:', JSON.stringify(rows[0]));
      console.log('[IMPORT] Primeira linha mapeada:', mapearColunas(rows[0]));
    }

    const colunasEncontradas = rows.length > 0 ? Object.keys(rows[0]) : [];
    const previewLinhas = [];
    let importados = 0, atualizados = 0, ignorados = 0;
    const erros = [];

    for (let i = 0; i < rows.length; i++) {
      const row  = rows[i];
      const lead = mapearColunas(row);

      // Sanidade: se nome_empresa parece número sequencial e email vazio → ignorar
      if (pareceNumeroSequencial(lead.nome_empresa) && !emailParece(lead.email)) {
        ignorados++;
        continue;
      }

      // Obrigatoriedade: pelo menos nome ou email real
      const temNome  = lead.nome_empresa && lead.nome_empresa.length > 1;
      const temEmail = emailParece(lead.email);
      if (!temNome && !temEmail) {
        ignorados++;
        continue;
      }

      // Limpar CNPJ
      if (lead.cnpj) lead.cnpj = lead.cnpj.replace(/\D/g, '') || null;
      else           lead.cnpj = null;

      // Guardar para preview
      if (previewLinhas.length < 5) {
        previewLinhas.push({
          nome_empresa: lead.nome_empresa || '',
          email:        lead.email        || '',
          telefone:     lead.telefone     || '',
          nicho:        lead.nicho        || '',
          cnpj:         lead.cnpj         || '',
        });
      }

      if (modo === 'preview') continue; // não salva no preview

      try {
        let existente = null;
        if (temEmail || lead.cnpj) {
          const conds = [];
          const vals  = [];
          if (temEmail) { vals.push(lead.email); conds.push(`email = $${vals.length}`); }
          if (lead.cnpj){ vals.push(lead.cnpj);  conds.push(`cnpj = $${vals.length}`); }
          const { rows: ex } = await db.query(
            `SELECT id FROM prospects WHERE ${conds.join(' OR ')} LIMIT 1`, vals,
          );
          existente = ex[0] || null;
        }

        if (existente) {
          await db.query(
            `UPDATE prospects SET
               nome_empresa      = COALESCE(NULLIF($1,''), nome_empresa),
               telefone          = COALESCE(NULLIF($2,''), telefone),
               nicho             = COALESCE(NULLIF($3,''), nicho),
               responsavel_nome  = COALESCE(NULLIF($4,''), responsavel_nome),
               responsavel_cargo = COALESCE(NULLIF($5,''), responsavel_cargo),
               cidade            = COALESCE(NULLIF($6,''), cidade),
               updated_at        = NOW()
             WHERE id = $7`,
            [lead.nome_empresa||null, lead.telefone||null, lead.nicho||null,
             lead.responsavel_nome||null, lead.responsavel_cargo||null,
             lead.cidade||null, existente.id],
          );
          atualizados++;
        } else {
          const nome = lead.nome_empresa || lead.email;
          await db.query(
            `INSERT INTO prospects
               (nome, empresa, nome_empresa, email, telefone, nicho, cnpj,
                responsavel_nome, responsavel_cargo, cidade, origem, status, status_contato)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [nome, lead.nome_empresa||null, lead.nome_empresa||null,
             lead.email||null, lead.telefone||null, lead.nicho||null, lead.cnpj||null,
             lead.responsavel_nome||null, lead.responsavel_cargo||null, lead.cidade||null,
             'importacao', 'novo_lead', 'novo_lead'],
          );
          importados++;
        }
      } catch (e) {
        erros.push({ linha: i + 2, erro: e.message });
      }
    }

    const resultado = {
      modo,
      importados, atualizados, ignorados,
      erros,
      total: importados + atualizados,
      total_linhas: rows.length,
      colunas_encontradas: colunasEncontradas,
      preview: previewLinhas,
    };

    console.log('[IMPORT] Resultado:', JSON.stringify({ modo, importados, atualizados, ignorados, total_linhas: rows.length }));
    return res.json(resultado);
  } catch (err) {
    console.error('[IMPORT PROSPECTS]', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

function modeloPlanilha(req, res) {
  const dados = [
    ['Nome/Empresa', 'Email', 'Telefone/WhatsApp', 'Nicho/Segmento', 'CNPJ', 'Nome do Contato', 'Cargo'],
    ['Distribuidora Silva Ltda', 'contato@silva.com.br', '31999990000', 'Material de Construção', '12.345.678/0001-99', 'João Silva', 'Diretor'],
    ['Tech Soluções ME', 'tech@tech.com.br', '31988880000', 'Tecnologia', '98.765.432/0001-11', 'Maria Tech', 'CEO'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(dados);
  ws['!cols'] = [30,30,20,25,20,25,20].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo_leads_conlicit.xlsx"');
  return res.send(buf);
}

async function atualizarStatus(req, res) {
  const { id } = req.params;
  const { status_contato, data_ultimo_contato } = req.body ?? {};
  if (!status_contato) return res.status(400).json({ erro: 'status_contato é obrigatório' });
  try {
    const { rows: [p] } = await db.query(
      `UPDATE prospects SET
         status_contato = $1,
         status = $1,
         data_ultimo_contato = COALESCE($2, NOW()),
         updated_at = NOW()
       WHERE id = $3 RETURNING id, status_contato, status`,
      [status_contato, data_ultimo_contato || null, id],
    );
    if (!p) return res.status(404).json({ erro: 'Prospect não encontrado' });
    await registrarEvento(id, 'status_alterado',
      `Status alterado para "${status_contato}" por ${req.usuario?.email || 'sistema'}`);
    return res.json(p);
  } catch (e) {
    console.error('[Prospects] atualizarStatus:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizarStatusLote(req, res) {
  const { ids, status_contato, responsavel_id } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ erro: 'ids é obrigatório' });
  try {
    const sets = ['updated_at = NOW()'];
    const vals = [];
    if (status_contato) { vals.push(status_contato); sets.push(`status_contato = $${vals.length}`, `status = $${vals.length}`); }
    if (responsavel_id) { vals.push(responsavel_id); sets.push(`responsavel_id = $${vals.length}`); }
    if (vals.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
    vals.push(ids);
    await db.query(`UPDATE prospects SET ${sets.join(', ')} WHERE id = ANY($${vals.length}::int[])`, vals);
    return res.json({ ok: true, atualizados: ids.length });
  } catch (e) {
    console.error('[Prospects] atualizarStatusLote:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function exportarLote(req, res) {
  const idsRaw = req.query.ids;
  if (!idsRaw) return res.status(400).json({ erro: 'ids é obrigatório' });
  const ids = String(idsRaw).split(',').map(Number).filter(Boolean);
  try {
    const { rows } = await db.query(
      `SELECT nome_empresa, email, telefone, nicho, cnpj, responsavel_nome, responsavel_cargo,
              status_contato, created_at
       FROM prospects WHERE id = ANY($1::int[]) ORDER BY id`,
      [ids],
    );
    const header = ['Empresa', 'Email', 'Telefone', 'Nicho', 'CNPJ', 'Contato', 'Cargo', 'Status', 'Criado em'];
    const data = rows.map(r => [
      r.nome_empresa, r.email, r.telefone, r.nicho, r.cnpj,
      r.responsavel_nome, r.responsavel_cargo, r.status_contato,
      r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws['!cols'] = header.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="leads_exportados.xlsx"');
    return res.send(buf);
  } catch (e) {
    console.error('[Prospects] exportarLote:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = {
  listar, obterPorId, criar, atualizar, remover, eventos, analisar,
  receberLanding, webhookBrevo, registrarInteracao, followup, kpis,
  importarPlanilha, modeloPlanilha, upload,
  atualizarStatus, atualizarStatusLote, exportarLote,
};
