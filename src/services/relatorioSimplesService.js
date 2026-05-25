// Gerador HTML — Resumo de Oportunidade (para reunião de vendas)

const fs   = require('fs');
const path = require('path');

let LOGO_BASE64 = '';
try {
  const logoPath = path.join(__dirname, '../../public/assets/images/logo-branco.png');
  LOGO_BASE64 = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64');
} catch (e) {
  console.error('[relatorioSimples] Logo não encontrado:', e.message);
}

const LOGO_HTML = LOGO_BASE64
  ? `<img src="${LOGO_BASE64}" alt="Conlicit" style="height:28px;object-fit:contain;display:block">`
  : `<span style="font-size:20px;font-weight:900;color:white;letter-spacing:-.5px">7<span style="color:#4CC5D7">C</span> conlicit</span>`;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(v) {
  return (v == null || v === '' || String(v).trim() === '') ? '—' : String(v);
}

function fmtBRL(v) {
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return 'Valor sigiloso — verificar no edital';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDataHora(analise) {
  const dt = analise.data_hora_abertura || analise.data_abertura;
  if (!dt) return '—';
  try {
    const d = new Date(dt);
    if (isNaN(d.getTime())) return String(dt);
    const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
    if (analise.data_hora_abertura) {
      const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      return `${data} às ${hora}`;
    }
    return data;
  } catch { return String(dt); }
}

function parseJ(v, fb) {
  if (v == null) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

function scoreInfo(score) {
  if (score == null || score === '') return { label: '—', color: '#5F7A8A' };
  const n = parseInt(score, 10);
  if (n >= 70) return { label: 'Boa', color: '#38A169' };
  if (n >= 50) return { label: 'Regular', color: '#D97706' };
  return { label: 'Fraca', color: '#E24B4A' };
}

function labelEntrega(v) {
  if (!v) return null;
  if (v === 'integral') return 'Entrega Integral';
  if (v === 'parcelada') return 'Entrega Parcelada';
  return v;
}

function labelJulgamento(v) {
  if (!v) return null;
  if (v === 'por_item') return 'Julgamento por Item';
  if (v === 'por_lote') return 'Julgamento por Lote';
  if (v === 'global') return 'Julgamento Global';
  return v;
}

function tagHtml(label, variant) {
  const classes = { produto: 'tag-produto', servico: 'tag-servico', sim: 'tag-sim', nao: 'tag-nao', atencao: 'tag-atencao' };
  return `<span class="tag ${classes[variant] || 'tag-nao'}">${esc(label)}</span>`;
}

function gerarHTMLResumo(analise) {
  const score = analise.score != null ? parseInt(analise.score, 10) : null;
  const { label: scoreLabel, color: scoreColor } = scoreInfo(score);
  const scoreJust = analise.score_justificativa || '';

  const numero = analise.numero || analise.referencia || '—';
  const orgao  = fmt(analise.orgao);
  const uf     = analise.uf || '';
  const objeto = fmt(analise.objeto);
  const portal = fmt(analise.portal_disputa);
  const linkPortal = analise.link_pncp || null;
  const dataHora   = fmtDataHora(analise);

  const tipo = analise.tipo_fornecimento === 'produto' ? 'produto' : 'servico';
  const entregaLabel    = labelEntrega(analise.entrega_tipo);
  const julgamentoLabel = labelJulgamento(analise.julgamento_tipo);
  const localEntrega    = fmt(analise.locais_entrega);
  const prazoEntrega    = fmt(analise.prazo_entrega);

  const habJuridica = parseJ(analise.habilitacao_juridica_json, []);
  const habEcon     = parseJ(analise.habilitacao_economica_json, {});
  const capTec      = parseJ(analise.capacidade_tecnica_json, {});

  const exigeBalanco = habEcon.exige_balanco === true;
  const capitalMinimo = habEcon.capital_minimo || null;
  const detalhesEcon  = habEcon.detalhes || null;

  const exigeAtestado = capTec.exige_atestado === true;
  const descAtestado  = capTec.descricao || null;

  const hoje = new Date().toLocaleDateString('pt-BR');

  const tagsForncimento = [];
  if (entregaLabel) tagsForncimento.push(tagHtml(entregaLabel, 'produto'));
  if (julgamentoLabel) tagsForncimento.push(tagHtml(julgamentoLabel, 'produto'));

  const docsJuridicos = Array.isArray(habJuridica) && habJuridica.length > 0
    ? habJuridica.map(d => `<li>${esc(d)}</li>`).join('')
    : '<li>Não identificado no edital</li>';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resumo de Oportunidade — ${esc(numero)}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Barlow', 'Segoe UI', sans-serif; background:#f0f2f5; color:#080808; }
@media print {
  body { background:white; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
  .no-print { display:none !important; }
  .page { box-shadow:none; }
}
.print-bar {
  background:#182A39; padding:10px 24px;
  display:flex; justify-content:space-between; align-items:center;
  position:sticky; top:0; z-index:100;
}
.print-bar span { color:white; font-size:13px; font-weight:500; }
.btn-print {
  background:#4CC5D7; color:#182A39; border:none;
  padding:8px 20px; border-radius:6px; font-size:13px;
  font-weight:700; cursor:pointer; letter-spacing:.3px;
}
.btn-print:hover { background:#3ab0c1; }
.page { max-width:800px; margin:24px auto; background:white; border-radius:10px; box-shadow:0 2px 16px rgba(0,0,0,.12); overflow:hidden; }
@media print { .page { margin:0; border-radius:0; } }

.header { background:#182A39; padding:20px 28px 16px; }
.header-top { display:flex; justify-content:space-between; align-items:flex-start; }
.logo { display:flex; align-items:center; }
.header-label { font-size:8px; font-weight:700; color:#4CC5D7; letter-spacing:1.5px; text-transform:uppercase; text-align:right; }
.header-sub { font-size:9px; color:rgba(255,255,255,.55); margin-top:3px; text-align:right; }
.header-line { height:2px; background:#4CC5D7; margin-top:14px; border-radius:1px; }

.score-bar {
  display:flex; align-items:center; gap:16px;
  padding:14px 28px; background:#182A39; border-top:1px solid rgba(255,255,255,.08);
}
.score-circle {
  width:52px; height:52px; border-radius:50%;
  border:3px solid ${scoreColor};
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  flex-shrink:0;
}
.score-num { font-size:18px; font-weight:900; color:${scoreColor}; line-height:1; }
.score-lbl { font-size:7px; font-weight:700; color:${scoreColor}; margin-top:1px; text-transform:uppercase; }
.score-info { flex:1; }
.score-title { font-size:14px; font-weight:700; color:${scoreColor}; }
.score-just { font-size:10px; color:rgba(255,255,255,.65); margin-top:3px; line-height:1.4; }

.content { padding:20px 28px 24px; }

.secao { margin-bottom:14px; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden; }
.secao-header {
  background:#182A39; padding:7px 14px;
  display:flex; align-items:center; gap:8px;
}
.secao-num {
  width:18px; height:18px; border-radius:50%;
  background:#4CC5D7; color:#182A39;
  font-size:9px; font-weight:700;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.secao-titulo { font-size:9.5px; font-weight:700; color:white; text-transform:uppercase; letter-spacing:.6px; }
.secao-body { padding:12px 14px; }
.secao-valor { font-size:13px; font-weight:600; color:#080808; }
.secao-detalhe { font-size:11px; color:#555; margin-top:3px; line-height:1.45; }
.secao-label { font-size:9px; color:#888; text-transform:uppercase; margin-bottom:2px; font-weight:600; letter-spacing:.4px; }

.valor-grande { font-size:20px; font-weight:800; color:#182A39; }

.tag {
  display:inline-flex; align-items:center; padding:3px 9px; border-radius:20px;
  font-size:10px; font-weight:500; margin:2px 2px 2px 0;
}
.tag-produto { background:#E1F5EE; color:#085041; }
.tag-servico { background:#E6F1FB; color:#185FA5; }
.tag-sim { background:#EAF3DE; color:#3B6D11; }
.tag-nao { background:#F0F2F5; color:#5F7A8A; }
.tag-atencao { background:#FCEBEB; color:#A32D2D; }

.doc-lista { list-style:none; padding:0; }
.doc-lista li {
  padding:4px 0 4px 14px; font-size:11px; color:#333; position:relative;
  border-bottom:1px solid #f5f5f5; line-height:1.4;
}
.doc-lista li:last-child { border-bottom:none; }
.doc-lista li::before { content:'•'; color:#4CC5D7; font-weight:700; position:absolute; left:0; }

.grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px; }

.row-inline { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.row-inline span { font-size:12px; color:#333; }

a { color:#4CC5D7; text-decoration:none; }
a:hover { text-decoration:underline; }

.footer {
  background:#182A39; padding:10px 28px;
  display:flex; justify-content:space-between; align-items:center;
}
.footer span { font-size:9px; color:rgba(255,255,255,.45); }
</style>
</head>
<body>

<div class="print-bar no-print">
  <span>📋 Resumo de Oportunidade — ${esc(numero)}</span>
  <button class="btn-print" onclick="window.print()">🖨️ Salvar como PDF</button>
</div>

<div class="page">

  <div class="header">
    <div class="header-top">
      <div class="logo">${LOGO_HTML}</div>
      <div>
        <div class="header-label">Resumo de Oportunidade</div>
        <div class="header-sub">${esc(numero)} · ${esc(hoje)}</div>
      </div>
    </div>
    <div class="header-line"></div>
  </div>

  ${score != null ? `
  <div class="score-bar">
    <div class="score-circle">
      <div class="score-num">${score}</div>
      <div class="score-lbl">${esc(scoreLabel)}</div>
    </div>
    <div class="score-info">
      <div class="score-title">${esc(scoreLabel)} oportunidade</div>
      ${scoreJust ? `<div class="score-just">${esc(scoreJust)}</div>` : ''}
    </div>
  </div>` : ''}

  <div class="content">

    <!-- 1. ÓRGÃO -->
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">1</div>
        <div class="secao-titulo">Órgão Solicitante</div>
      </div>
      <div class="secao-body">
        <div class="secao-valor">${esc(orgao)}</div>
        ${uf ? `<div class="secao-detalhe">${esc(uf)}</div>` : ''}
      </div>
    </div>

    <!-- 2. VALOR -->
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">2</div>
        <div class="secao-titulo">Valor Estimado</div>
      </div>
      <div class="secao-body">
        <div class="valor-grande">${fmtBRL(analise.valor_estimado)}</div>
      </div>
    </div>

    <!-- 3. OBJETO -->
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">3</div>
        <div class="secao-titulo">Objeto</div>
      </div>
      <div class="secao-body">
        ${tagHtml(tipo === 'produto' ? '📦 Produto' : '🔧 Serviço', tipo)}
        <div class="secao-valor" style="margin-top:7px">${esc(objeto)}</div>
      </div>
    </div>

    <!-- 4. PLATAFORMA -->
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">4</div>
        <div class="secao-titulo">Plataforma</div>
      </div>
      <div class="secao-body">
        <div class="secao-valor">${esc(portal)}</div>
        ${linkPortal ? `<div class="secao-detalhe" style="margin-top:4px"><a href="${esc(linkPortal)}" target="_blank">${esc(linkPortal)}</a></div>` : ''}
      </div>
    </div>

    <!-- 5. DATA -->
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">5</div>
        <div class="secao-titulo">Data e Horário da Sessão</div>
      </div>
      <div class="secao-body">
        <div class="valor-grande">${esc(dataHora)}</div>
      </div>
    </div>

    <!-- 6. FORNECIMENTO -->
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">6</div>
        <div class="secao-titulo">Tipo de Fornecimento</div>
      </div>
      <div class="secao-body">
        ${tagsForncimento.length > 0 ? `<div style="margin-bottom:8px">${tagsForncimento.join('')}</div>` : ''}
        <div class="grid-2">
          <div>
            <div class="secao-label">Local de Entrega</div>
            <div class="secao-detalhe">${esc(localEntrega)}</div>
          </div>
          <div>
            <div class="secao-label">Prazo de Entrega</div>
            <div class="secao-detalhe">${esc(prazoEntrega)}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 7. HAB JURÍDICA -->
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">7</div>
        <div class="secao-titulo">Habilitação Jurídica</div>
      </div>
      <div class="secao-body">
        <ul class="doc-lista">${docsJuridicos}</ul>
      </div>
    </div>

    <!-- 8. HAB ECONÔMICA -->
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">8</div>
        <div class="secao-titulo">Habilitação Econômica</div>
      </div>
      <div class="secao-body">
        <div class="row-inline">
          <span>Exige Balanço Patrimonial:</span>
          ${tagHtml(exigeBalanco ? 'Sim' : 'Não', exigeBalanco ? 'atencao' : 'nao')}
        </div>
        ${capitalMinimo ? `<div class="secao-detalhe">Capital mínimo: ${esc(capitalMinimo)}</div>` : ''}
        ${detalhesEcon ? `<div class="secao-detalhe" style="margin-top:4px">${esc(detalhesEcon)}</div>` : ''}
        ${!exigeBalanco && !capitalMinimo && !detalhesEcon ? `<div class="secao-detalhe">Sem exigências econômico-financeiras especiais.</div>` : ''}
      </div>
    </div>

    <!-- 9. CAPACIDADE TÉCNICA -->
    <div class="secao">
      <div class="secao-header">
        <div class="secao-num">9</div>
        <div class="secao-titulo">Capacidade Técnica</div>
      </div>
      <div class="secao-body">
        <div class="row-inline">
          <span>Exige Atestado Técnico:</span>
          ${tagHtml(exigeAtestado ? 'Sim ⚠️' : 'Não', exigeAtestado ? 'atencao' : 'nao')}
        </div>
        ${descAtestado ? `<div class="secao-detalhe">${esc(descAtestado)}</div>` : ''}
        ${!exigeAtestado && !descAtestado ? `<div class="secao-detalhe">Sem exigência de atestado de capacidade técnica.</div>` : ''}
      </div>
    </div>

  </div>

  <div class="footer">
    <span>Conlicit Hub · hub.conlicit.com</span>
    <span>Análise preparada pela Conlicit · ${esc(hoje)}</span>
  </div>

</div>
</body>
</html>`;
}

module.exports = { gerarHTMLResumo };
