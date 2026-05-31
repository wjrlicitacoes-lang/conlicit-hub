const db      = require('../database/db');
const axios   = require('axios');

const ADMIN_WPP   = process.env.ADMIN_WHATSAPP;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'wjrlicitacoes@gmail.com';

const UFS_VALIDAS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

async function notificarWhatsApp(prospect) {
  if (!ADMIN_WPP || !process.env.ZAPI_INSTANCE || !process.env.ZAPI_TOKEN) return;
  const kws = (prospect.palavras_chave || []).join(', ') || '—';
  const msg =
    `🆕 *Novo Lead — Conlicit Hub*\n\n` +
    `👤 *Nome:* ${prospect.nome}\n` +
    `🏢 *Empresa:* ${prospect.empresa || '—'}\n` +
    `📱 *WhatsApp:* ${prospect.whatsapp || '—'}\n` +
    `📧 *Email:* ${prospect.email || '—'}\n` +
    `📍 *UF:* ${prospect.uf || '—'}\n` +
    `🏷️ *Segmentos:* ${kws}\n\n` +
    `_Acesse o Hub para acompanhar._`;

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) headers['client-token'] = process.env.ZAPI_CLIENT_TOKEN;

  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
    { phone: ADMIN_WPP, message: msg },
    { headers, timeout: 10000 },
  ).catch(e => console.warn('[Formulário] WPP falhou:', e.message));
}

async function notificarEmail(prospect) {
  if (!RESEND_KEY) return;
  const kws = (prospect.palavras_chave || []).join(', ') || '—';
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#182A39;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="text-align:center;padding:20px 0 28px;">
      <span style="font-size:20px;font-weight:700;color:#e8f4f7;">con<span style="color:#4CC5D7;">licit</span></span>
    </div>
    <div style="background:#1f3547;border-radius:12px;padding:28px;">
      <h1 style="font-size:18px;color:#4CC5D7;margin:0 0 20px;">🆕 Novo lead pelo formulário</h1>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr><td style="padding:6px 0;color:#7fa8bb;width:90px">Nome</td><td style="padding:6px 0;color:#e8f4f7">${prospect.nome}</td></tr>
        <tr><td style="padding:6px 0;color:#7fa8bb">Empresa</td><td style="padding:6px 0;color:#e8f4f7">${prospect.empresa || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#7fa8bb">WhatsApp</td><td style="padding:6px 0;color:#e8f4f7">${prospect.whatsapp || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#7fa8bb">Email</td><td style="padding:6px 0;color:#e8f4f7">${prospect.email || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#7fa8bb">UF</td><td style="padding:6px 0;color:#e8f4f7">${prospect.uf || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#7fa8bb">Segmentos</td><td style="padding:6px 0;color:#e8f4f7">${kws}</td></tr>
      </table>
    </div>
    <div style="text-align:center;padding:16px 0;">
      <p style="font-size:12px;color:#4a6a7f;margin:0;">Conlicit Hub — Sistema de Gestão de Licitações</p>
    </div>
  </div>
</body></html>`;

  await axios.post(
    'https://api.resend.com/emails',
    {
      from: process.env.BOLETIM_FROM_EMAIL || 'onboarding@resend.dev',
      to: ADMIN_EMAIL,
      subject: `🆕 Novo lead: ${prospect.nome} (${prospect.empresa || prospect.uf || 'sem empresa'})`,
      html,
    },
    { headers: { Authorization: `Bearer ${RESEND_KEY}` }, timeout: 10000 },
  ).catch(e => console.warn('[Formulário] Email falhou:', e.message));
}

async function receber(req, res) {
  const { nome, empresa, email, whatsapp, uf, palavras_chave, como_conheceu } = req.body ?? {};

  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório' });
  if (!whatsapp?.replace(/\D/g, '')) return res.status(400).json({ erro: 'WhatsApp é obrigatório' });
  if (uf && !UFS_VALIDAS.includes(uf.toUpperCase())) return res.status(400).json({ erro: 'UF inválida' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'Email inválido' });

  const kws = Array.isArray(palavras_chave)
    ? palavras_chave.filter(Boolean).map(s => s.trim()).slice(0, 10)
    : [];

  const notas = como_conheceu ? `Como conheceu: ${como_conheceu}` : null;

  try {
    const { rows: [p] } = await db.query(
      `INSERT INTO prospects
         (nome, empresa, email, whatsapp, uf, palavras_chave, notas, status, origem_formulario)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'novo_lead',TRUE)
       RETURNING *`,
      [
        nome.trim(),
        empresa?.trim() || null,
        email?.trim().toLowerCase() || null,
        whatsapp.replace(/\D/g, ''),
        uf?.toUpperCase() || null,
        kws,
        notas,
      ],
    );

    // Notificações em background — não bloqueia a resposta
    Promise.all([
      notificarWhatsApp(p),
      notificarEmail(p),
    ]).catch(e => console.error('[Formulário] Notificação falhou:', e.message));

    console.log(`[Formulário] Novo lead: ${p.nome} (${p.whatsapp})`);
    return res.status(201).json({ mensagem: 'Cadastro recebido com sucesso', id: p.id });

  } catch (e) {
    console.error('[Formulário] Erro:', e.message);
    return res.status(500).json({ erro: 'Erro interno ao salvar cadastro' });
  }
}

module.exports = { receber };
