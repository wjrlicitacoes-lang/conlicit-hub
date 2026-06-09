// Integração com Brevo (ex-Sendinblue) para disparo de emails de prospecção
const axios = require('axios');

const BREVO_API    = 'https://api.brevo.com/v3/smtp/email';
const API_KEY      = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'noreply@conlicit.com';
const SENDER_NAME  = process.env.BREVO_SENDER_NAME  || 'Conlicit';
const LINK_FERR    = process.env.LINK_FERRAMENTA_CAPTACAO || 'https://conlicit.com/ferramentas';

function substituirVariaveis(texto, variaveis) {
  return texto.replace(/\{\{(\w+)\}\}/g, (_, key) => variaveis[key] ?? `{{${key}}}`);
}

async function enviarEmail({ destinatarioEmail, destinatarioNome, assunto, corpoHtml, variaveis = {} }) {
  if (!API_KEY) {
    console.warn('[emailService] BREVO_API_KEY não configurada — email não enviado');
    return { simulado: true, mensagem: 'BREVO_API_KEY ausente' };
  }

  const varsComPadrao = {
    link_ferramenta: LINK_FERR,
    remetente_nome:  SENDER_NAME,
    ...variaveis,
  };

  const assuntoFinal  = substituirVariaveis(assunto, varsComPadrao);
  const corpoFinal    = substituirVariaveis(corpoHtml, varsComPadrao);
  // Converter texto puro para HTML simples se não tiver tags
  const htmlFinal = corpoFinal.includes('<') ? corpoFinal
    : corpoFinal.split('\n').map(l => l.trim() ? `<p style="margin:0 0 10px">${l}</p>` : '').join('');

  const payload = {
    sender:   { email: SENDER_EMAIL, name: SENDER_NAME },
    to:       [{ email: destinatarioEmail, name: destinatarioNome || destinatarioEmail }],
    subject:  assuntoFinal,
    htmlContent: `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:20px">${htmlFinal}</body></html>`,
  };

  const { data } = await axios.post(BREVO_API, payload, {
    headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  return data;
}

module.exports = { enviarEmail, substituirVariaveis };
