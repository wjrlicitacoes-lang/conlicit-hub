const axios = require('axios');
const db = require('../database/db');

function limparTelefone(tel) {
  const d = tel.replace(/\D/g, '');
  return d.startsWith('55') && d.length >= 12 ? d : '55' + d;
}

function formatarDataHoraBR(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

async function enviarWhatsApp(whatsapp, mensagem) {
  const instance = process.env.ZAPI_INSTANCE;
  const zapiToken = process.env.ZAPI_TOKEN;
  if (!instance || !zapiToken) throw new Error('ZAPI_INSTANCE/ZAPI_TOKEN não configurados');
  const { data } = await axios.post(
    `https://api.z-api.io/instances/${instance}/token/${zapiToken}/send-text`,
    { phone: limparTelefone(whatsapp), message: mensagem },
    { timeout: 15000 },
  );
  return data;
}

async function enviarEmailAlerta(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada');
  const from = process.env.BOLETIM_FROM_EMAIL || 'onboarding@resend.dev';
  const { data } = await axios.post(
    'https://api.resend.com/emails',
    { from, to, subject, html },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 },
  );
  return data;
}

function montarMensagemWpp(p, tipoLabel) {
  const dt = formatarDataHoraBR(p.data_hora_abertura);
  let msg = `⏰ *Alerta ${tipoLabel} — ConlicitHub*\n\n`;
  msg += `📋 *Pregão:* ${p.numero}\n`;
  msg += `🏢 *Cliente:* ${p.cliente_nome}\n`;
  if (p.orgao) msg += `🏛️ *Órgão:* ${p.orgao}\n`;
  if (p.objeto) msg += `📝 *Objeto:* ${String(p.objeto).slice(0, 200)}\n`;
  msg += `🕐 *Abertura:* ${dt}\n`;
  if (p.operador_nome) msg += `👤 *Operador:* ${p.operador_nome}\n`;
  return msg;
}

function montarHtmlAlerta(p, tipoLabel) {
  const dt = formatarDataHoraBR(p.data_hora_abertura);
  const rows = [
    ['Pregão', p.numero || '—'],
    ['Cliente', p.cliente_nome || '—'],
    p.orgao ? ['Órgão', p.orgao] : null,
    p.objeto ? ['Objeto', String(p.objeto).slice(0, 300)] : null,
    ['Abertura', dt],
    p.operador_nome ? ['Operador', p.operador_nome] : null,
  ].filter(Boolean).map(([label, value]) =>
    `<tr><td style="padding:6px 0;color:#7fa8bb;width:90px">${label}</td>`
    + `<td style="padding:6px 0;color:#e8f4f7">${value}</td></tr>`,
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#182A39;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="text-align:center;padding:16px 0 24px;">
      <span style="font-size:20px;font-weight:700;color:#e8f4f7;">Conlicit<span style="color:#4CC5D7;">Hub</span></span>
    </div>
    <div style="background:#1f3547;border-radius:12px;padding:28px;">
      <h1 style="font-size:18px;color:#4CC5D7;margin:0 0 20px;">⏰ Alerta ${tipoLabel}</h1>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>
    </div>
    <div style="text-align:center;padding:16px 0;">
      <p style="font-size:12px;color:#4a6a7f;margin:0;">ConlicitHub — Sistema de Gestão de Licitações</p>
    </div>
  </div>
</body></html>`;
}

// Windows (min/max hours before the pregão opens) where each alert fires
const JANELAS = [
  { campo: 'alerta_vespera_enviado', minH: 18, maxH: 26, label: 'Véspera' },
  { campo: 'alerta_48h_enviado',     minH: 47, maxH: 49, label: '48 horas' },
  { campo: 'alerta_24h_enviado',     minH: 23, maxH: 25, label: '24 horas' },
  { campo: 'alerta_2h_enviado',      minH: 1.5, maxH: 2.5, label: '2 horas' },
  { campo: 'alerta_1h_enviado',      minH: 0.5, maxH: 1.5, label: '1 hora' },
];

async function processarAlertas() {
  const { rows: admins } = await db.query(`SELECT email FROM usuarios WHERE role = 'admin'`);
  const adminEmails = admins.map((r) => r.email);
  const adminWhatsapp = process.env.ADMIN_WHATSAPP;

  for (const janela of JANELAS) {
    const { rows: pregoes } = await db.query(
      `SELECT p.*, c.nome AS cliente_nome, u.nome AS operador_nome
       FROM pregoes p
       JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN usuarios u ON u.id = p.operador_id
       WHERE p.data_hora_abertura IS NOT NULL
         AND p.status = 'a_disputar'
         AND p.${janela.campo} = FALSE
         AND p.data_hora_abertura > NOW() + INTERVAL '${janela.minH} hours'
         AND p.data_hora_abertura < NOW() + INTERVAL '${janela.maxH} hours'`,
    );

    if (pregoes.length === 0) continue;
    console.log(`[Alertas] ${janela.label}: ${pregoes.length} pregão(ões)`);

    for (const p of pregoes) {
      const subject = `⏰ Alerta ${janela.label} — Pregão ${p.numero} (${p.cliente_nome})`;

      // Buscar emails de admins e sócios fundadores
      const { rows: destinatarios } = await db.query(
        `SELECT email, whatsapp FROM usuarios
         WHERE role IN ('admin','socio_fundador')
           AND email IS NOT NULL AND email <> ''`
      );

      for (const dest of destinatarios) {
        try {
          await enviarEmailAlerta(dest.email, subject, montarHtmlAlerta(p, janela.label));
        } catch (e) {
          console.error(`[Alertas] Email ${dest.email}:`, e.message);
        }
        if (dest.whatsapp) {
          try {
            await enviarWhatsApp(dest.whatsapp, montarMensagemWpp(p, janela.label));
          } catch (e) {
            console.error(`[Alertas] WhatsApp sócio:`, e.message);
          }
        }
      }

      // Fallback: admin WPP da env
      if (adminWhatsapp && !destinatarios.find(d => d.whatsapp === adminWhatsapp)) {
        try {
          await enviarWhatsApp(adminWhatsapp, montarMensagemWpp(p, janela.label));
        } catch (e) {
          console.error(`[Alertas] WhatsApp env:`, e.message);
        }
      }

      await db.query(`UPDATE pregoes SET ${janela.campo} = TRUE WHERE id = $1`, [p.id]);
    }
  }
}

module.exports = { processarAlertas };
