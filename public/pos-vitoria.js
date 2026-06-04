'use strict';

const API = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://web-production-18d79.up.railway.app';

// ── Auth ──────────────────────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem('ch_token') || sessionStorage.getItem('ch_token') || null;
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return m ? m[2] : null;
}

async function fetchAPI(endpoint, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(API + endpoint, { ...opts, headers });
  if (resp.status === 401) {
    mostrarToast('Sessão expirada. Redirecionando...', 'err');
    setTimeout(() => { window.location.href = '/'; }, 1500);
    throw new Error('Não autorizado');
  }
  const data = await resp.json();
  if (!data.sucesso) throw new Error(data.erro || 'Erro desconhecido');
  return data;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let _toastTimer = null;
function mostrarToast(msg, tipo = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show toast-${tipo}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ── Formatação ────────────────────────────────────────────────────────────────

function fmtBRL(v) {
  if (v == null || v === '') return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + (d.includes('T') ? '' : 'T12:00:00'));
  return dt.toLocaleDateString('pt-BR');
}
function fmtPct(v) { return v != null ? Number(v).toFixed(2) + '%' : '—'; }
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function badgeStatus(s) { return `<span class="badge badge-${esc(s)}">${esc(s?.replace(/_/g,' '))}</span>`; }

// ── Estado ────────────────────────────────────────────────────────────────────

let contratos = [];
let contratoAtual = null;
let nfsAtuais = [];
let comissoesAtuais = [];

// ── KPIs ─────────────────────────────────────────────────────────────────────

async function carregarKPIs() {
  try {
    const { dados } = await fetchAPI('/api/pos-vitoria/kpis');
    document.getElementById('kpi-contratos').textContent = dados.total_contratos_ativos;
    document.getElementById('kpi-valor').textContent = fmtBRL(dados.valor_total_contratos);
    document.getElementById('kpi-comissao-receber').textContent = fmtBRL(dados.comissao_a_receber);
    document.getElementById('kpi-comissao-mes').textContent = fmtBRL(dados.comissao_recebida_mes);
    document.getElementById('kpi-nfs').textContent = dados.nfs_aguardando_cobranca;
    const atrasEl = document.getElementById('kpi-atrasadas');
    atrasEl.textContent = dados.cobrancas_atrasadas;
    atrasEl.className = 'kpi-value' + (dados.cobrancas_atrasadas > 0 ? ' danger' : '');
  } catch (e) {
    console.error('[KPI]', e.message);
  }
}

// ── Contratos ─────────────────────────────────────────────────────────────────

async function carregarContratos() {
  const tbody = document.getElementById('tbody-contratos');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="8"><div class="spinner"></div></td></tr>';
  try {
    const status = document.getElementById('filtro-status').value;
    const nome = document.getElementById('filtro-cliente').value.trim();
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (nome)   params.set('cliente_nome', nome);
    const { dados } = await fetchAPI('/api/pos-vitoria/contratos?' + params);
    contratos = dados;
    renderContratos();
  } catch (e) {
    mostrarToast(e.message, 'err');
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Erro ao carregar contratos.</td></tr>';
  }
}

function renderContratos() {
  const tbody = document.getElementById('tbody-contratos');
  if (!contratos.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty"><div class="icon">📋</div>Nenhum contrato encontrado.</div></td></tr>';
    return;
  }
  tbody.innerHTML = contratos.map(c => `
    <tr onclick="abrirContrato(${c.id})">
      <td><strong>${esc(c.cliente_nome)}</strong></td>
      <td>${esc(c.numero_pregao)}</td>
      <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.orgao)}</td>
      <td style="color:#4CC5D7;font-weight:600">${fmtBRL(c.valor_contrato)}</td>
      <td>${fmtPct(c.percentual_comissao)}</td>
      <td>${fmtBRL(c.comissao_total)}</td>
      <td>${badgeStatus(c.status)}</td>
      <td>${fmtDate(c.data_vitoria)}</td>
    </tr>
  `).join('');
}

// ── Modal Novo Contrato ───────────────────────────────────────────────────────

function abrirModalContrato() {
  document.getElementById('form-contrato').reset();
  abrirModal('modal-contrato');
}

async function salvarContrato() {
  const f = document.getElementById('form-contrato');
  const dados = {
    cliente_nome: f.cliente_nome.value.trim(),
    modalidade: f.modalidade.value,
    numero_pregao: f.numero_pregao.value.trim(),
    orgao: f.orgao.value.trim(),
    objeto: f.objeto.value.trim(),
    valor_contrato: f.valor_contrato.value,
    percentual_comissao: f.percentual_comissao.value,
    data_vitoria: f.data_vitoria.value,
    data_assinatura: f.data_assinatura.value || null,
    data_vigencia_inicio: f.data_vigencia_inicio.value || null,
    data_vigencia_fim: f.data_vigencia_fim.value || null,
    observacoes: f.observacoes.value.trim() || null,
  };
  try {
    setBtnLoading('btn-salvar-contrato', true);
    await fetchAPI('/api/pos-vitoria/contratos', { method: 'POST', body: JSON.stringify(dados) });
    fecharModal('modal-contrato');
    mostrarToast('Contrato criado com sucesso!');
    await Promise.all([carregarKPIs(), carregarContratos()]);
  } catch (e) {
    mostrarToast(e.message, 'err');
  } finally {
    setBtnLoading('btn-salvar-contrato', false);
  }
}

// ── Detalhe do Contrato ───────────────────────────────────────────────────────

async function abrirContrato(id) {
  try {
    const { dados } = await fetchAPI(`/api/pos-vitoria/contratos/${id}`);
    contratoAtual = dados;
    renderDetalheContrato(dados);
    await Promise.all([carregarNFsDetalhe(id), carregarComissoesDetalhe(id)]);
    ativarTab('tab-nfs');
    abrirModal('modal-detalhe');
  } catch (e) {
    mostrarToast(e.message, 'err');
  }
}

function renderDetalheContrato(c) {
  document.getElementById('det-num').textContent = c.numero_pregao;
  document.getElementById('det-nome').textContent = c.cliente_nome;
  document.getElementById('det-orgao').textContent = c.orgao;
  document.getElementById('det-objeto').textContent = c.objeto || '—';
  document.getElementById('det-valor').textContent = fmtBRL(c.valor_contrato);
  document.getElementById('det-pct').textContent = fmtPct(c.percentual_comissao);
  document.getElementById('det-comissao-total').textContent = fmtBRL(c.comissao_total);
  document.getElementById('det-faturado').textContent = fmtBRL(c.total_faturado);
  document.getElementById('det-status').innerHTML = badgeStatus(c.status);
  document.getElementById('det-vitoria').textContent = fmtDate(c.data_vitoria);
  document.getElementById('det-assinatura').textContent = fmtDate(c.data_assinatura);
  document.getElementById('det-vigencia').textContent =
    (c.data_vigencia_inicio || c.data_vigencia_fim)
      ? `${fmtDate(c.data_vigencia_inicio)} → ${fmtDate(c.data_vigencia_fim)}`
      : '—';

  // Select de status
  document.getElementById('select-status-contrato').value = c.status;
}

async function alterarStatusContrato() {
  const novoStatus = document.getElementById('select-status-contrato').value;
  try {
    await fetchAPI(`/api/pos-vitoria/contratos/${contratoAtual.id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: novoStatus }),
    });
    contratoAtual.status = novoStatus;
    document.getElementById('det-status').innerHTML = badgeStatus(novoStatus);
    mostrarToast('Status atualizado!');
    carregarContratos();
    carregarKPIs();
  } catch (e) {
    mostrarToast(e.message, 'err');
  }
}

// ── Notas Fiscais ─────────────────────────────────────────────────────────────

async function carregarNFsDetalhe(contratoId) {
  const tbody = document.getElementById('tbody-nfs');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="6"><div class="spinner"></div></td></tr>';
  try {
    const { dados } = await fetchAPI(`/api/pos-vitoria/contratos/${contratoId}/notas-fiscais`);
    nfsAtuais = dados;
    renderNFs();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Erro ao carregar NFs.</td></tr>';
  }
}

function renderNFs() {
  const tbody = document.getElementById('tbody-nfs');
  if (!nfsAtuais.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="icon">🧾</div>Nenhuma NF emitida.</div></td></tr>';
    return;
  }
  tbody.innerHTML = nfsAtuais.map(nf => `
    <tr>
      <td><strong>${esc(nf.numero_nf)}</strong></td>
      <td>${fmtDate(nf.data_emissao)}</td>
      <td style="color:#4CC5D7;font-weight:600">${fmtBRL(nf.valor_nf)}</td>
      <td>${fmtBRL(nf.valor_comissao)}</td>
      <td>${badgeStatus(nf.status_cobranca)}</td>
      <td>
        <div class="td-actions">
          ${nf.arquivo_nf_url ? `<a class="btn btn-ghost btn-xs" href="${esc(nf.arquivo_nf_url)}" target="_blank">📄 Ver</a>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function abrirModalNF() {
  document.getElementById('form-nf').reset();
  if (contratoAtual) {
    document.getElementById('nf-pct').value = contratoAtual.percentual_comissao;
  }
  abrirModal('modal-nf');
}

async function salvarNF() {
  const f = document.getElementById('form-nf');
  const fd = new FormData();
  fd.append('contrato_id', contratoAtual.id);
  fd.append('numero_nf', f.numero_nf.value.trim());
  fd.append('data_emissao', f.data_emissao.value);
  fd.append('valor_nf', f.valor_nf.value);
  fd.append('percentual_aplicado', f.percentual_aplicado.value);
  if (f.prazo_pagamento.value) fd.append('prazo_pagamento', f.prazo_pagamento.value);
  if (f.observacoes.value.trim()) fd.append('observacoes', f.observacoes.value.trim());
  if (f.arquivo_nf.files[0]) fd.append('arquivo_nf', f.arquivo_nf.files[0]);

  try {
    setBtnLoading('btn-salvar-nf', true);
    await fetchAPI('/api/pos-vitoria/notas-fiscais', { method: 'POST', body: fd });
    fecharModal('modal-nf');
    mostrarToast('NF registrada e comissão gerada!');
    await Promise.all([
      carregarNFsDetalhe(contratoAtual.id),
      carregarComissoesDetalhe(contratoAtual.id),
      carregarKPIs(),
      carregarContratos(),
    ]);
  } catch (e) {
    mostrarToast(e.message, 'err');
  } finally {
    setBtnLoading('btn-salvar-nf', false);
  }
}

// ── Comissões ─────────────────────────────────────────────────────────────────

async function carregarComissoesDetalhe(contratoId) {
  const tbody = document.getElementById('tbody-comissoes');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="6"><div class="spinner"></div></td></tr>';
  try {
    const { dados } = await fetchAPI(`/api/pos-vitoria/contratos/${contratoId}/comissoes`);
    comissoesAtuais = dados;
    renderComissoes();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Erro ao carregar comissões.</td></tr>';
  }
}

function renderComissoes() {
  const tbody = document.getElementById('tbody-comissoes');
  if (!comissoesAtuais.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="icon">💰</div>Nenhuma comissão gerada.</div></td></tr>';
    return;
  }
  tbody.innerHTML = comissoesAtuais.map(co => `
    <tr>
      <td><strong>${esc(co.numero_nf)}</strong></td>
      <td>${fmtDate(co.data_emissao)}</td>
      <td style="color:#4CC5D7;font-weight:600">${fmtBRL(co.valor_esperado)}</td>
      <td>${co.valor_recebido ? fmtBRL(co.valor_recebido) : '—'}</td>
      <td>${badgeStatus(co.status)}</td>
      <td>
        <div class="td-actions">
          ${co.status !== 'recebida' && co.status !== 'cancelada'
            ? `<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();abrirModalRecebimento(${co.id})">Registrar</button>`
            : ''}
          ${co.data_recebimento ? fmtDate(co.data_recebimento) : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

// ── Modal Recebimento ─────────────────────────────────────────────────────────

let comissaoIdAtual = null;

function abrirModalRecebimento(comissaoId) {
  comissaoIdAtual = comissaoId;
  const co = comissoesAtuais.find(c => c.id === comissaoId);
  document.getElementById('form-recebimento').reset();
  if (co) {
    document.getElementById('rec-valor').value = co.valor_esperado;
    document.getElementById('rec-data').value = new Date().toISOString().slice(0, 10);
  }
  abrirModal('modal-recebimento');
}

async function salvarRecebimento() {
  const f = document.getElementById('form-recebimento');
  const dados = {
    status: f.status.value,
    valor_recebido: f.valor_recebido.value || null,
    data_recebimento: f.data_recebimento.value || null,
    forma_pagamento: f.forma_pagamento.value || null,
    observacoes: f.observacoes.value.trim() || null,
  };
  try {
    setBtnLoading('btn-salvar-rec', true);
    await fetchAPI(`/api/pos-vitoria/comissoes/${comissaoIdAtual}/recebimento`, {
      method: 'POST', body: JSON.stringify(dados),
    });
    fecharModal('modal-recebimento');
    mostrarToast('Recebimento registrado!');
    await Promise.all([
      carregarComissoesDetalhe(contratoAtual.id),
      carregarNFsDetalhe(contratoAtual.id),
      carregarKPIs(),
    ]);
  } catch (e) {
    mostrarToast(e.message, 'err');
  } finally {
    setBtnLoading('btn-salvar-rec', false);
  }
}

// ── Helpers de modal / tabs ───────────────────────────────────────────────────

function abrirModal(id) { document.getElementById(id).classList.add('open'); }
function fecharModal(id) { document.getElementById(id).classList.remove('open'); }

function ativarTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

function setBtnLoading(id, loading) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.orig = btn.dataset.orig || btn.textContent;
  btn.textContent = loading ? 'Aguarde...' : btn.dataset.orig;
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (!getToken()) {
    window.location.href = '/';
    return;
  }
  carregarKPIs();
  carregarContratos();

  // Fechar modal ao clicar no overlay
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
});
