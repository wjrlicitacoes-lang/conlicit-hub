// ConlicitHub Monitor — Popup Script

const $ = (id) => document.getElementById(id);

let globalPaused = false;
let sessions = [];

// ── Inicializa popup ──
async function init() {
  await carregarSettings();
  await carregarSessions();
  await limparUnread();
  setInterval(carregarSessions, 3000); // atualiza a cada 3s enquanto popup está aberto
}

// ── Carrega configurações salvas ──
async function carregarSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) return;
  $('inputEmail').value = settings.email || 'wjrlicitacoes@gmail.com';
  $('inputApiKey').value = settings.resendApiKey || '';
  $('inputFromEmail').value = settings.fromEmail || '';
  globalPaused = settings.globalPaused || false;
  atualizarBotaoPauseAll();
}

// ── Carrega sessões do background ──
async function carregarSessions() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' });
    sessions = resp?.sessions || [];
    renderizarSessions();
  } catch {}
}

// ── Limpa badge de não lidas ──
async function limparUnread() {
  try { await chrome.runtime.sendMessage({ type: 'CLEAR_UNREAD' }); } catch {}
}

// ── Renderiza lista de sessões ──
function renderizarSessions() {
  const lista = $('sessionsList');
  const empty = $('emptyState');
  const ativas = sessions.filter((s) => s.ativo);

  if (ativas.length === 0) {
    empty.style.display = '';
    lista.innerHTML = '';
    atualizarStatusBar(0);
    return;
  }

  empty.style.display = 'none';
  atualizarStatusBar(ativas.length);

  lista.innerHTML = ativas.map((s) => {
    const statusLabel = s.pausado ? 'Pausado' : s.chatEncontrado ? 'Ativo' : 'Aguardando chat';
    const statusClass = s.pausado ? 'pausado' : s.chatEncontrado ? 'ativo' : 'aguardando';
    const cardClass = s.pausado ? 'paused' : s.totalMensagens > 0 ? 'has-activity' : '';
    const ultimaVez = s.lastSeen ? formatarTempo(s.lastSeen) : '—';

    const ultimaMsg = s.ultimaMensagem
      ? `<div class="session-last-msg">💬 ${escapeHtml(s.ultimaMensagem)}</div>`
      : '';

    return `
      <div class="session-card ${cardClass}" data-session="${s.sessionId}">
        <div class="session-header">
          <div>
            <div class="session-portal">${escapeHtml(s.portalNome)}</div>
            <div class="session-pregao">Pregão ${escapeHtml(s.pregaoNumero)}</div>
          </div>
        </div>
        <div class="session-meta">
          <span>🕐 ${ultimaVez}</span>
          <span>📨 ${s.totalMensagens || 0} msg${s.totalMensagens !== 1 ? 's' : ''}</span>
        </div>
        ${ultimaMsg}
        <div class="session-footer">
          <span class="status-pill ${statusClass}">${statusLabel}</span>
          <button class="btn-toggle ${s.pausado ? '' : 'pausing'}"
            data-session="${s.sessionId}"
            data-paused="${s.pausado}">
            ${s.pausado ? '▶ Retomar' : '⏸ Pausar'}
          </button>
        </div>
      </div>`;
  }).join('');

  // Event listeners nos botões de toggle
  lista.querySelectorAll('.btn-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sid = btn.dataset.session;
      const novoPaused = btn.dataset.paused !== 'true';
      await chrome.runtime.sendMessage({
        type: 'SET_SESSION_PAUSED',
        sessionId: sid,
        paused: novoPaused,
      });
      await carregarSessions();
    });
  });
}

// ── Status bar ──
function atualizarStatusBar(count) {
  const dot = $('statusDot');
  const text = $('statusText');

  if (globalPaused) {
    dot.className = 'status-indicator paused';
    text.textContent = 'Monitoramento pausado';
  } else if (count === 0) {
    dot.className = 'status-indicator offline';
    text.textContent = 'Nenhum pregão monitorado';
  } else {
    dot.className = 'status-indicator';
    text.textContent = `Monitorando ${count} pregão${count !== 1 ? 'ões' : ''}`;
  }
}

function atualizarBotaoPauseAll() {
  const btn = $('btnPauseAll');
  btn.textContent = globalPaused ? '▶' : '⏸';
  btn.title = globalPaused ? 'Retomar tudo' : 'Pausar tudo';
}

// ── Formata tempo relativo ──
function formatarTempo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min atrás`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h atrás`;
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Eventos ──
$('btnPauseAll').addEventListener('click', async () => {
  globalPaused = !globalPaused;
  await chrome.runtime.sendMessage({ type: 'SET_GLOBAL_PAUSED', paused: globalPaused });
  atualizarBotaoPauseAll();
  atualizarStatusBar(sessions.filter((s) => s.ativo).length);
});

$('settingsToggle').addEventListener('click', () => {
  const body = $('settingsBody');
  const aberto = body.style.display !== 'none';
  body.style.display = aberto ? 'none' : 'block';
  $('settingsToggle').style.color = aberto ? '' : '#7fa8bb';
});

$('btnSave').addEventListener('click', async () => {
  const email = $('inputEmail').value.trim();
  const resendApiKey = $('inputApiKey').value.trim();
  const fromEmail = $('inputFromEmail').value.trim();

  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: { ...settings, email, resendApiKey, fromEmail },
  });

  const msg = $('saveMsg');
  msg.textContent = '✓ Configurações salvas';
  msg.style.color = '#2ecc71';
  setTimeout(() => { msg.textContent = ''; }, 2500);
});

// ── Inicia ──
init();
