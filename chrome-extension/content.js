// ConlicitHub Monitor — Content Script
// Injected in all monitored procurement portals

const PORTAL_CONFIGS = {
  'licitardigital.com.br': {
    id: 'licitardigital',
    nome: 'Licitar Digital',
    chatSelectors: [
      '.timeline-body',
      '.chat-messages',
      '.direct-chat-messages',
      '.mensagens-wrapper',
      '[class*="chat-message"]',
      '[class*="mensagem-lista"]',
      '#chat-body',
      '.sala-chat',
      '.conteudo-chat',
    ],
    messageSelectors: [
      '.timeline-item',
      '.direct-chat-msg',
      '.mensagem-item',
      '[class*="mensagem-row"]',
      '[class*="chat-item"]',
      '[data-message-id]',
      'li[class*="message"]',
    ],
    pregaoFromUrl: [
      /\/pregao\/(\d+)/i,
      /\/sessao\/(\d+)/i,
      /\/licitacao\/(\d+)/i,
      /[?&](?:id|pregao)=(\d+)/i,
    ],
    pregaoFromPage: [
      '.numero-pregao', '.edital-numero', '.licitacao-numero',
      '[class*="numero-processo"]', '[class*="numero-pregao"]',
      'h1', 'h2', '.titulo-sessao',
    ],
  },
  'portaldecompraspublicas.com.br': {
    id: 'portaldecompras',
    nome: 'Portal de Compras Públicas',
    chatSelectors: [
      '.chat-messages',
      '.conversation-list',
      '.sala-virtual-chat',
      '[class*="chat-content"]',
      '[class*="mensagem-container"]',
      '#divMensagens',
      '.painel-chat',
    ],
    messageSelectors: [
      '.chat-message',
      '.conversation-item',
      '[class*="mensagem-item"]',
      '[class*="message-row"]',
      'li[class*="chat"]',
      '[data-id-mensagem]',
    ],
    pregaoFromUrl: [
      /\/pregao\/(\d+)/i,
      /\/licitacao\/(\d+)/i,
      /[?&](?:id|licitacaoId|pregaoId)=(\d+)/i,
    ],
    pregaoFromPage: [
      '.numero-licitacao', '.titulo-pregao',
      '[class*="numero-processo"]', 'h1', 'h2',
    ],
  },
  'compras.gov.br': {
    id: 'comprasgov',
    nome: 'Compras.gov.br',
    chatSelectors: [
      '#tabelaMensagens',
      '.chat-container',
      '[class*="mensagem"]',
      '#divChat',
      '.painel-mensagens',
      'table[id*="mensagem"]',
      'table[id*="chat"]',
    ],
    messageSelectors: [
      'tr[id*="msg"]',
      'tr[class*="mensagem"]',
      '[class*="linha-mensagem"]',
      '[class*="message-item"]',
      'tr:has(td[class*="msg"])',
    ],
    pregaoFromUrl: [
      /codigoUasg=(\d+)/i,
      /numPregao=(\d+)/i,
      /[?&](?:id|pregao|uasg)=(\d+)/i,
      /\/pregao\/(\d+)/i,
    ],
    pregaoFromPage: [
      '#numPregao', '#codigoPregao', '[class*="numero-pregao"]',
      'h1', 'h2', '.titulo-pagina', '#spanNumeroPregao',
    ],
  },
  'compras.mg.gov.br': {
    id: 'comprasmg',
    nome: 'Compras MG',
    chatSelectors: [
      '.sala-chat',
      '.chat-messages',
      '.mensagens-sessao',
      '[class*="chat"]',
      '[class*="mensagem-lista"]',
      '#chatContainer',
      '.conteudo-sessao',
    ],
    messageSelectors: [
      '[class*="mensagem-item"]',
      '[class*="chat-message"]',
      '.timeline-item',
      '[data-mensagem-id]',
      'li[class*="mensagem"]',
    ],
    pregaoFromUrl: [
      /\/pregao\/(\d+)/i,
      /\/sessao\/(\d+)/i,
      /[?&](?:id|pregaoId)=(\d+)/i,
    ],
    pregaoFromPage: [
      '.numero-pregao', '#numPregao', '[class*="numero"]',
      'h1', 'h2',
    ],
  },
};

// ── Número padrão de pregão BR ──
const PREGAO_PATTERNS = [
  /(\d{1,4}\/20\d{2})/,      // 001/2026
  /PE[- ]?n?[°º]?\s*(\d+)/i, // PE 001
  /PP[- ]?n?[°º]?\s*(\d+)/i, // PP 001
  /Pregão[^\d]*(\d+)/i,       // Pregão Eletrônico 001
  /n[°º]\s*(\d{3,})/i,        // Nº 00123
  /(\d{5,})/,                  // fallback: any 5+ digit number
];

const LS_KEY = '__conlicithub_seen__';

// ── Detecta portal ──
function detectarPortal() {
  const host = location.hostname.replace(/^www\./, '');
  for (const [domain, config] of Object.entries(PORTAL_CONFIGS)) {
    if (host === domain || host.endsWith('.' + domain)) return config;
  }
  return null;
}

// ── Extrai número do pregão ──
function extrairNumeroPregao(config) {
  // 1. Da URL
  for (const re of config.pregaoFromUrl) {
    const m = (location.href).match(re);
    if (m) {
      // Tenta enriquecer com número legível da página
      const legivel = extrairNumeroPagina(config);
      return legivel || m[1];
    }
  }
  // 2. Da página
  return extrairNumeroPagina(config) || `Tab-${Date.now()}`;
}

function extrairNumeroPagina(config) {
  for (const sel of config.pregaoFromPage) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const texto = el.innerText?.trim() || '';
    for (const re of PREGAO_PATTERNS) {
      const m = texto.match(re);
      if (m) return m[1] || m[0];
    }
    // Também tenta o title completo
    const tituloM = document.title.match(PREGAO_PATTERNS[0]);
    if (tituloM) return tituloM[1];
  }
  // Fallback: title da página
  for (const re of PREGAO_PATTERNS) {
    const m = document.title.match(re);
    if (m) return m[1] || m[0];
  }
  return null;
}

// ── Encontra container do chat ──
function encontrarContainerChat(config) {
  for (const sel of config.chatSelectors) {
    const el = document.querySelector(sel);
    if (el && el.children.length > 0) return el;
  }
  return null;
}

// ── Extrai mensagens do container ──
function extrairMensagens(container, config) {
  for (const sel of config.messageSelectors) {
    const elementos = container.querySelectorAll(sel);
    if (elementos.length === 0) continue;
    const msgs = [];
    elementos.forEach((el) => {
      const texto = el.innerText?.trim() || '';
      if (texto.length < 2) return;
      const fp = gerarFingerprint(texto);
      msgs.push({ fp, texto: texto.slice(0, 500) });
    });
    if (msgs.length > 0) return msgs;
  }
  // Fallback genérico: qualquer elemento com texto substancial
  const fallback = [];
  container.querySelectorAll('div, li, tr, p').forEach((el) => {
    if (el.children.length > 3) return; // skip containers
    const texto = el.innerText?.trim() || '';
    if (texto.length >= 10 && texto.length <= 1000) {
      fallback.push({ fp: gerarFingerprint(texto), texto: texto.slice(0, 500) });
    }
  });
  return fallback;
}

// ── Fingerprint simples para deduplicação ──
function gerarFingerprint(texto) {
  const s = texto.trim().replace(/\s+/g, ' ').slice(0, 120);
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

// ── localStorage para mensagens já vistas ──
function carregarVistas() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch { return {}; }
}

function salvarVistas(vistas) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(vistas));
  } catch {}
}

function marcarVista(sessionId, fp) {
  const vistas = carregarVistas();
  if (!vistas[sessionId]) vistas[sessionId] = [];
  if (!vistas[sessionId].includes(fp)) {
    vistas[sessionId].push(fp);
    // Mantém no máximo 500 fingerprints por sessão
    if (vistas[sessionId].length > 500) vistas[sessionId] = vistas[sessionId].slice(-500);
    salvarVistas(vistas);
  }
}

function jaFoiVista(sessionId, fp) {
  const vistas = carregarVistas();
  return (vistas[sessionId] || []).includes(fp);
}

// ── Toca alerta sonoro (Web Audio API) ──
function tocarAlerta() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const sequencia = [
      { freq: 880,  inicio: 0.00, dur: 0.12 },
      { freq: 1100, inicio: 0.18, dur: 0.12 },
      { freq: 880,  inicio: 0.36, dur: 0.25 },
    ];
    sequencia.forEach(({ freq, inicio, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.35, ctx.currentTime + inicio);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + inicio + dur);
      osc.start(ctx.currentTime + inicio);
      osc.stop(ctx.currentTime + inicio + dur + 0.05);
    });
  } catch {}
}

// ── Estado local ──
let config = null;
let sessionId = null;
let pregaoNumero = null;
let container = null;
let snapshotAnterior = new Set();
let pausado = false;
let inicializado = false;

// ── Inicialização ──
function inicializar() {
  config = detectarPortal();
  if (!config) return;

  pregaoNumero = extrairNumeroPregao(config);
  sessionId = `${config.id}:${pregaoNumero}`;

  container = encontrarContainerChat(config);

  // Registra com o background
  chrome.runtime.sendMessage({
    type: 'REGISTER',
    portalId: config.id,
    portalNome: config.nome,
    pregaoNumero,
    sessionId,
    url: location.href,
    chatEncontrado: !!container,
  });

  if (container) {
    configurarObserver();
    tirarSnapshot(); // snapshot inicial para não alertar mensagens antigas
    inicializado = true;
    console.log(`[ConlicitHub] Monitorando ${config.nome} — Pregão ${pregaoNumero}`);
  } else {
    console.log(`[ConlicitHub] Chat não encontrado em ${config.nome}, aguardando...`);
  }
}

// ── Snapshot inicial (mensagens já existentes = não alertar) ──
function tirarSnapshot() {
  const msgs = extrairMensagens(container, config);
  const vistas = carregarVistas();
  if (!vistas[sessionId]) vistas[sessionId] = [];
  msgs.forEach(({ fp }) => {
    if (!vistas[sessionId].includes(fp)) vistas[sessionId].push(fp);
  });
  salvarVistas(vistas);
  snapshotAnterior = new Set(msgs.map((m) => m.fp));
}

// ── MutationObserver no container do chat ──
function configurarObserver() {
  const observer = new MutationObserver(() => {
    if (pausado) return;
    verificarNovasMensagens();
  });
  observer.observe(container, { childList: true, subtree: true, characterData: true });
}

// ── Verifica mensagens novas ──
function verificarNovasMensagens() {
  if (!container || !config || pausado) return;

  const msgs = extrairMensagens(container, config);
  const novas = msgs.filter(({ fp }) => !jaFoiVista(sessionId, fp));

  novas.forEach(({ fp, texto }) => {
    marcarVista(sessionId, fp);
    snapshotAnterior.add(fp);

    chrome.runtime.sendMessage({
      type: 'NOVA_MENSAGEM',
      sessionId,
      portalId: config.id,
      portalNome: config.nome,
      pregaoNumero,
      url: location.href,
      mensagem: { fp, texto },
    });
  });
}

// ── Listener: mensagens do background ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PLAY_SOUND') {
    tocarAlerta();
    sendResponse({ ok: true });
  }
  if (msg.type === 'SET_PAUSED') {
    pausado = msg.paused;
    sendResponse({ ok: true });
  }
  if (msg.type === 'PING') {
    sendResponse({
      ok: true,
      sessionId,
      pregaoNumero,
      portalNome: config?.nome,
      chatEncontrado: !!container,
      pausado,
    });
    // Aproveita o ping para verificar mensagens novas
    if (!pausado && container) verificarNovasMensagens();
  }
  return true;
});

// ── Tenta encontrar o chat periodicamente (SPA / carregamento tardio) ──
function tentarEncontrarChat() {
  if (inicializado) return;

  container = encontrarContainerChat(config);
  if (container) {
    configurarObserver();
    tirarSnapshot();
    inicializado = true;
    console.log(`[ConlicitHub] Chat encontrado em ${config.nome} — Pregão ${pregaoNumero}`);
    chrome.runtime.sendMessage({
      type: 'CHAT_ENCONTRADO',
      sessionId,
      pregaoNumero,
    });
  }
}

// ── Detecta navegação SPA ──
let urlAnterior = location.href;
const navObserver = new MutationObserver(() => {
  if (location.href !== urlAnterior) {
    urlAnterior = location.href;
    inicializado = false;
    container = null;
    setTimeout(inicializar, 800);
  }
});
navObserver.observe(document.body || document.documentElement, { childList: true, subtree: false });

// ── Inicia ──
inicializar();

// Retry loop para chat de carregamento tardio (até 2 min)
const retryInterval = setInterval(() => {
  if (inicializado) { clearInterval(retryInterval); return; }
  tentarEncontrarChat();
}, 5000);
setTimeout(() => clearInterval(retryInterval), 120000);
