// ConlicitHub Monitor — Background Service Worker

const DEFAULT_EMAIL = 'wjrlicitacoes@gmail.com';
const RESEND_URL = 'https://api.resend.com/emails';
const ALARM_NAME = 'conlicithub-poll';

// ── Sessões ativas: {sessionId → {portalId, portalNome, pregaoNumero, url, tabId, lastSeen, totalMensagens, ativo, pausado}}
let sessions = {};
let unreadCount = 0;

// ── Inicialização ──
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) {
    await chrome.storage.local.set({
      settings: {
        email: DEFAULT_EMAIL,
        resendApiKey: '',
        globalPaused: false,
      },
    });
  }
  criarAlarme();
  console.log('[ConlicitHub] Extension instalada');
});

chrome.runtime.onStartup.addListener(() => {
  criarAlarme();
});

function criarAlarme() {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 }); // 30 segundos
    }
  });
}

// ── Alarme: heartbeat a cada 30s ──
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await pingSessions();
});

// ── Pinga todas as tabs monitoradas ──
async function pingSessions() {
  const tabs = await chrome.tabs.query({ url: getMonitoredPatterns() });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
    } catch {}
  }
}

function getMonitoredPatterns() {
  return [
    'https://*.licitardigital.com.br/*',
    'https://licitardigital.com.br/*',
    'https://*.portaldecompraspublicas.com.br/*',
    'https://portaldecompraspublicas.com.br/*',
    'https://*.compras.gov.br/*',
    'https://compras.gov.br/*',
    'https://compras.mg.gov.br/*',
    'https://*.compras.mg.gov.br/*',
  ];
}

// ── Listener: mensagens dos content scripts ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'REGISTER':
      handleRegister(msg, tabId);
      sendResponse({ ok: true });
      break;

    case 'CHAT_ENCONTRADO':
      if (sessions[msg.sessionId]) {
        sessions[msg.sessionId].chatEncontrado = true;
        sessions[msg.sessionId].ativo = true;
      }
      sendResponse({ ok: true });
      break;

    case 'NOVA_MENSAGEM':
      handleNovaMensagem(msg, tabId);
      sendResponse({ ok: true });
      break;
  }
  return true;
});

// ── Registra nova sessão ──
function handleRegister(msg, tabId) {
  sessions[msg.sessionId] = {
    portalId: msg.portalId,
    portalNome: msg.portalNome,
    pregaoNumero: msg.pregaoNumero,
    sessionId: msg.sessionId,
    url: msg.url,
    tabId,
    lastSeen: Date.now(),
    totalMensagens: 0,
    chatEncontrado: msg.chatEncontrado,
    ativo: true,
    pausado: false,
  };
  atualizarBadge();
  console.log(`[ConlicitHub] Registrado: ${msg.portalNome} — Pregão ${msg.pregaoNumero}`);
}

// ── Processa nova mensagem ──
async function handleNovaMensagem(msg, tabId) {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings?.globalPaused) return;

  const session = sessions[msg.sessionId];
  if (session?.pausado) return;

  if (session) {
    session.lastSeen = Date.now();
    session.totalMensagens = (session.totalMensagens || 0) + 1;
    session.ultimaMensagem = msg.mensagem.texto.slice(0, 100);
  }

  unreadCount++;
  atualizarBadge();

  // Notificação Chrome
  const notifId = `conlicithub-${Date.now()}`;
  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: `🔔 ${msg.portalNome} — Pregão ${msg.pregaoNumero}`,
    message: msg.mensagem.texto.slice(0, 200),
    priority: 2,
  });

  // Abre a tab ao clicar na notificação
  chrome.notifications.onClicked.addListener((id) => {
    if (id === notifId && tabId) {
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(sender?.tab?.windowId || chrome.windows.WINDOW_ID_CURRENT, { focused: true });
    }
  });

  // Som: pede ao content script para tocar
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PLAY_SOUND' });
    } catch {}
  }

  // Email via Resend
  if (settings?.resendApiKey) {
    await enviarEmail(settings, msg);
  }
}

// ── Envia email via Resend ──
async function enviarEmail(settings, msg) {
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const texto = msg.mensagem.texto;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#182A39;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="text-align:center;padding:20px 0 24px;">
      <span style="font-size:20px;font-weight:700;color:#e8f4f7;">Conlicit<span style="color:#4CC5D7;">Hub</span></span>
    </div>
    <div style="background:#1f3547;border-radius:12px;padding:24px;margin-bottom:20px;border-left:4px solid #4CC5D7;">
      <div style="font-size:12px;color:#4CC5D7;font-weight:600;margin-bottom:8px;">🔔 NOVA MENSAGEM NO CHAT</div>
      <div style="font-size:18px;font-weight:700;color:#e8f4f7;margin-bottom:4px;">${msg.portalNome}</div>
      <div style="font-size:14px;color:#7fa8bb;margin-bottom:16px;">Pregão ${msg.pregaoNumero}</div>
      <div style="background:#0e2233;border-radius:8px;padding:16px;font-size:14px;color:#b0d4de;line-height:1.6;word-break:break-word;">${escapeHtml(texto)}</div>
    </div>
    <div style="text-align:center;margin-bottom:16px;">
      <a href="${msg.url}" style="display:inline-block;background:#4CC5D7;color:#182A39;font-weight:700;font-size:13px;padding:10px 24px;border-radius:6px;text-decoration:none;">Abrir sessão →</a>
    </div>
    <div style="text-align:center;font-size:11px;color:#3a5a6f;">${dataHora} · ConlicitHub Monitor</div>
  </div>
</body></html>`;

  try {
    const resp = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.resendApiKey}`,
      },
      body: JSON.stringify({
        from: settings.fromEmail || 'onboarding@resend.dev',
        to: settings.email || DEFAULT_EMAIL,
        subject: `🔔 Nova mensagem — Pregão ${msg.pregaoNumero} (${msg.portalNome})`,
        html,
      }),
    });
    const data = await resp.json();
    console.log('[ConlicitHub] Email enviado:', data?.id || data);
  } catch (e) {
    console.error('[ConlicitHub] Erro ao enviar email:', e.message);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Badge no ícone da extensão ──
function atualizarBadge() {
  const ativos = Object.values(sessions).filter((s) => s.ativo).length;
  if (ativos === 0) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  chrome.action.setBadgeText({ text: unreadCount > 0 ? String(unreadCount) : String(ativos) });
  chrome.action.setBadgeBackgroundColor({ color: unreadCount > 0 ? '#e74c3c' : '#4CC5D7' });
}

// ── Remove sessões de tabs fechadas ──
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [sid, s] of Object.entries(sessions)) {
    if (s.tabId === tabId) {
      sessions[sid].ativo = false;
    }
  }
  atualizarBadge();
});

// ── API para o popup ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_SESSIONS') {
    sendResponse({ sessions: Object.values(sessions) });
  }
  if (msg.type === 'SET_SESSION_PAUSED') {
    if (sessions[msg.sessionId]) {
      sessions[msg.sessionId].pausado = msg.paused;
      // Avisa o content script
      const tabId = sessions[msg.sessionId].tabId;
      if (tabId) chrome.tabs.sendMessage(tabId, { type: 'SET_PAUSED', paused: msg.paused }).catch(() => {});
    }
    sendResponse({ ok: true });
  }
  if (msg.type === 'SET_GLOBAL_PAUSED') {
    chrome.storage.local.get('settings', ({ settings }) => {
      chrome.storage.local.set({ settings: { ...settings, globalPaused: msg.paused } });
    });
    sendResponse({ ok: true });
  }
  if (msg.type === 'CLEAR_UNREAD') {
    unreadCount = 0;
    atualizarBadge();
    sendResponse({ ok: true });
  }
  return true;
});

criarAlarme();
