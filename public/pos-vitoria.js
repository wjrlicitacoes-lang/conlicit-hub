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
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><div class="icon">📋</div>Nenhum contrato encontrado.</div></td></tr>';
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
      <td onclick="event.stopPropagation()">
        <button onclick="abrirRelatorioContrato(${c.id})"
          style="background:rgba(76,197,215,0.12);color:#4CC5D7;border:1px solid rgba(76,197,215,0.25);padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap">
          📊 Relatório
        </button>
      </td>
    </tr>
  `).join('');
}

async function abrirRelatorioContrato(contratoId) {
  mostrarToast('Gerando relatório…', 'info');
  try {
    const { dados } = await fetchAPI(`/api/pos-vitoria/contratos/${contratoId}/relatorio`);
    renderModalRelatorio(dados);
  } catch(e) { mostrarToast('Erro ao gerar relatório: ' + e.message, 'err'); }
}

function renderModalRelatorio(dados) {
  const { contrato: c, notas_fiscais, comissoes, resumo } = dados;
  const fmt   = v => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(v || 0);
  const fmtDt = d => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
  const STATUS = { recebida:'✔ Recebida', pendente:'⏳ Pendente', enviada:'📨 Enviada', atrasada:'⚠ Atrasada' };

  let modal = document.getElementById('modal-relatorio-pv');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-relatorio-pv';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
    modal.onclick = e => { if(e.target===modal) modal.remove(); };
    document.body.appendChild(modal);
  }

  const esc = s => (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  modal.innerHTML = `
    <div id="relatorio-conteudo-pv" style="background:#fff;color:#111;width:100%;max-width:760px;border-radius:12px;font-family:sans-serif;overflow:hidden">
      <div style="background:#182A39;padding:28px 32px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="color:#4CC5D7;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">conlicit</div>
          <div style="color:#fff;font-size:18px;font-weight:700">Relatório de Contrato</div>
          <div style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:2px">Gerado em ${new Date().toLocaleDateString('pt-BR')}</div>
        </div>
        <div style="text-align:right">
          <div style="color:#fff;font-size:13px;font-weight:600">${esc(c.modalidade||'')}</div>
          <div style="color:#4CC5D7;font-size:15px;font-weight:700">${esc(c.numero_pregao||'')}</div>
        </div>
      </div>
      <div style="padding:24px 32px;border-bottom:1px solid #eee">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          ${[['Cliente',c.cliente_nome],['Órgão',c.orgao],['Objeto',c.objeto||'—'],
             ['Data da Vitória',fmtDt(c.data_vitoria)],
             ['Vigência',c.data_vigencia_inicio?fmtDt(c.data_vigencia_inicio)+' → '+fmtDt(c.data_vigencia_fim):'—'],
             ['Status',c.status]].map(([l,v]) => `
            <div>
              <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">${l}</div>
              <div style="font-size:14px;font-weight:500">${esc(v||'—')}</div>
            </div>`).join('')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #eee">
        ${[['Valor do Contrato',fmt(c.valor_contrato),'#182A39'],
           ['Comissão ('+(c.percentual_comissao||0)+'%)',fmt(resumo.total_comissao),'#4CC5D7'],
           ['Total Recebido',fmt(resumo.total_recebido),'#16a34a'],
           ['Pendente',fmt(resumo.total_pendente),resumo.total_pendente>0?'#d97706':'#16a34a'],
          ].map(([l,v,cor]) => `
          <div style="padding:16px 20px;border-right:1px solid #eee">
            <div style="font-size:11px;color:#888;margin-bottom:4px">${l}</div>
            <div style="font-size:16px;font-weight:700;color:${cor}">${v}</div>
          </div>`).join('')}
      </div>
      <div style="padding:24px 32px">
        <div style="font-size:14px;font-weight:700;margin-bottom:14px;color:#182A39">Notas Fiscais e Comissões</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f5f7f9">
              <th style="padding:8px 12px;text-align:left;color:#555;border-bottom:2px solid #e5e7eb">NF</th>
              <th style="padding:8px 12px;text-align:left;color:#555;border-bottom:2px solid #e5e7eb">Emissão</th>
              <th style="padding:8px 12px;text-align:right;color:#555;border-bottom:2px solid #e5e7eb">Valor NF</th>
              <th style="padding:8px 12px;text-align:right;color:#555;border-bottom:2px solid #e5e7eb">Comissão</th>
              <th style="padding:8px 12px;text-align:center;color:#555;border-bottom:2px solid #e5e7eb">Status</th>
            </tr>
          </thead>
          <tbody>
            ${(notas_fiscais||[]).map((nf,i) => {
              const cm = (comissoes||[]).find(cm => cm.nota_fiscal_id === nf.id);
              return `<tr style="background:${i%2===0?'#fff':'#f9fafb'}">
                <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0">${esc(nf.numero_nf||'')}</td>
                <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;color:#666">${fmtDt(nf.data_emissao)}</td>
                <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:500">${fmt(nf.valor_nf)}</td>
                <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#182A39">${fmt(nf.valor_comissao)}</td>
                <td style="padding:9px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:12px">${cm?(STATUS[cm.status]||cm.status):'—'}</td>
              </tr>`;}).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#182A39;color:#fff">
              <td colspan="2" style="padding:10px 12px;font-weight:700">TOTAL</td>
              <td style="padding:10px 12px;text-align:right;font-weight:700">${fmt(resumo.total_faturado)}</td>
              <td style="padding:10px 12px;text-align:right;font-weight:700;color:#4CC5D7">${fmt(resumo.total_comissao)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="padding:16px 32px;background:#f8f9fa;border-top:1px solid #eee;font-size:11px;color:#888;display:flex;justify-content:space-between">
        <span>Conlicit — Consultoria em Licitações · Belo Horizonte, MG</span>
        <span>Documento gerado pelo Conlicit Hub</span>
      </div>
    </div>
    <div id="relatorio-acoes-pv" style="position:fixed;bottom:24px;right:24px;display:flex;gap:10px;z-index:300">
      <button onclick="document.getElementById('modal-relatorio-pv').remove()"
        style="background:rgba(255,255,255,0.1);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:13px;cursor:pointer;backdrop-filter:blur(4px)">
        Fechar
      </button>
      <button onclick="imprimirRelatorioPV()"
        style="background:#4CC5D7;color:#182A39;border:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">
        🖨️ Imprimir / Salvar PDF
      </button>
    </div>
  `;
  modal.style.display = 'flex';
}

function imprimirRelatorioPV() {
  const style = document.createElement('style');
  style.id = 'print-style-pv';
  style.innerHTML = `
    @media print {
      body > *:not(#modal-relatorio-pv) { display: none !important; }
      #modal-relatorio-pv { position: static !important; background: white !important; padding: 0 !important; overflow: visible !important; }
      #relatorio-acoes-pv { display: none !important; }
      #relatorio-conteudo-pv { border-radius: 0 !important; max-width: 100% !important; }
      @page { margin: 0; size: A4; }
    }
  `;
  document.head.appendChild(style);
  window.print();
  setTimeout(() => { const s = document.getElementById('print-style-pv'); if (s) s.remove(); }, 1000);
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
