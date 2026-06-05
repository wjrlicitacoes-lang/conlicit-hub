const db    = require('../database/db');
const axios = require('axios');

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
  const { status, segmento, data_de, data_ate, origem, q } = req.query;
  const conds = [];
  const vals  = [];

  if (status)   { vals.push(status);   conds.push(`p.status = $${vals.length}`); }
  if (segmento) { vals.push(segmento); conds.push(`p.segmento = $${vals.length}`); }
  if (origem)   { vals.push(origem);   conds.push(`p.origem = $${vals.length}`); }
  if (data_de)  { vals.push(data_de);  conds.push(`p.created_at >= $${vals.length}`); }
  if (data_ate) { vals.push(data_ate); conds.push(`p.created_at <= $${vals.length} + interval '1 day'`); }
  if (q) {
    vals.push(`%${q}%`);
    const n = vals.length;
    conds.push(`(p.nome ILIKE $${n} OR p.empresa ILIKE $${n} OR p.email ILIKE $${n})`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  try {
    const { rows } = await db.query(
      `SELECT p.*, ae.status AS analise_status
         FROM prospects p
         LEFT JOIN analises_edson ae ON ae.id = p.analise_edson_id
         ${where}
         ORDER BY p.created_at DESC`,
      vals,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Prospects] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criar(req, res) {
  const {
    nome, email, whatsapp, empresa, segmento, status, notas, responsavel,
    indicado_por, edital, obs, origem,
  } = req.body ?? {};
  if (!nome?.trim()) return res.status(400).json({ erro: 'nome é obrigatório' });
  try {
    const { rows: [p] } = await db.query(
      `INSERT INTO prospects
         (nome, email, whatsapp, empresa, segmento, status, notas, responsavel,
          indicado_por, edital, obs, origem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        nome.trim(), email || null, whatsapp || null, empresa || null,
        segmento || null, status || 'novo_lead', notas || null,
        responsavel || null, indicado_por || null,
        edital || null, obs || null, origem || 'manual',
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
         updated_at=NOW()
       WHERE id=$14 RETURNING *`,
      [
        nome, email || null, whatsapp || null, empresa || null, segmento || null,
        status || antes.status, notas || null, responsavel || null,
        indicado_por || null, edital || null, obs || null,
        origem || null, brevo_email_id || null, id,
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

module.exports = { listar, criar, atualizar, remover, eventos, analisar, receberLanding, webhookBrevo };
