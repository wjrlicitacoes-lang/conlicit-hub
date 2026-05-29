// ── Z-API Service — Conlicit Hub ──────────────────────────────────────
const axios = require('axios');

const BASE  = process.env.ZAPI_BASE_URL || 'https://api.z-api.io';
const INST  = process.env.ZAPI_INSTANCE;
const TOKEN = process.env.ZAPI_TOKEN;

if (!INST || !TOKEN) {
  console.warn('[Z-API] ZAPI_INSTANCE ou ZAPI_TOKEN não configurados');
}

const client = axios.create({
  baseURL: `${BASE}/instances/${INST}/token/${TOKEN}`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

async function enviarTexto(telefone, mensagem) {
  const numero = telefone.replace(/\D/g, '');
  const r = await client.post('/send-text', { phone: numero, message: mensagem });
  return r.data;
}

async function enviarBotoes(telefone, titulo, corpo, rodape, botoes) {
  const numero = telefone.replace(/\D/g, '');
  const r = await client.post('/send-button-list', {
    phone: numero,
    title: titulo,
    message: corpo,
    footer: rodape,
    buttonList: {
      buttons: botoes.map((b, i) => ({ id: b.id || String(i + 1), label: b.label })),
    },
  });
  return r.data;
}

async function enviarGrupo(groupId, mensagem) {
  const r = await client.post('/send-text', { phone: groupId, message: mensagem });
  return r.data;
}

async function verificarConexao() {
  const r = await client.get('/status');
  return r.data;
}

module.exports = { enviarTexto, enviarBotoes, enviarGrupo, verificarConexao };
