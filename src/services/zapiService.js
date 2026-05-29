// ── Z-API Service — Conlicit Hub ──────────────────────────────────────
const axios = require('axios');

const BASE  = process.env.ZAPI_BASE_URL || 'https://api.z-api.io';
const INST  = process.env.ZAPI_INSTANCE;
const TOKEN = process.env.ZAPI_TOKEN;

if (!INST || !TOKEN) {
  console.warn('[Z-API] ZAPI_INSTANCE ou ZAPI_TOKEN não configurados');
}

const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;

const client = axios.create({
  baseURL: `${BASE}/instances/${INST}/token/${TOKEN}`,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    ...(CLIENT_TOKEN ? { 'client-token': CLIENT_TOKEN } : {}),
  },
});

if (!CLIENT_TOKEN) {
  console.warn('[Z-API] ZAPI_CLIENT_TOKEN não configurado — algumas requisições podem falhar');
}

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
  let id = String(groupId).trim();
  if (id.includes('chat.whatsapp.com')) {
    throw new Error('Use o ID do grupo, não o link de convite. Busque os grupos pelo Hub.');
  }
  if (!id.includes('@')) {
    id = id + '@g.us';
  }
  const r = await client.post('/send-text', { phone: id, message: mensagem });
  return r.data;
}

async function verificarConexao() {
  const r = await client.get('/status');
  return r.data;
}

module.exports = { enviarTexto, enviarBotoes, enviarGrupo, verificarConexao };
