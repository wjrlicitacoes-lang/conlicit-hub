const PDFDocument = require('pdfkit');

// ── Constantes visuais ────────────────────────────────────────────────────────

const NAVY  = '#182A39';
const TEAL  = '#4CC5D7';
const WHITE = '#FFFFFF';
const BLACK = '#080808';
const GRAY  = '#5F7A8A';
const LGRAY = '#DDDDDD';

const PW = 595.28;   // A4 largura
const PH = 841.89;   // A4 altura
const ML = 30;        // margem esquerda
const MR = 30;        // margem direita
const CW = PW - ML - MR; // largura do conteúdo

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v) { return (v == null || v === '') ? '—' : String(v); }

function validStr(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s && s !== '—' && s !== 'null' &&
    !s.includes('não identificado') && !s.includes('nao identificado') &&
    !s.includes('não informado');
}

function fmtBRL(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return String(v); }
}

function fmtHora(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function trunc(str, max) {
  const s = str == null ? '—' : String(str);
  if (!s || s === '—') return s;
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function parseJSON(val, fallback) {
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function nivelCor(nivel) {
  if (!nivel) return LGRAY;
  const s = String(nivel).toLowerCase();
  if (s === 'alto')  return '#E24B4A';
  if (s === 'médio' || s === 'medio') return '#D97706';
  return '#38A169';
}

function descricaoDisputa(modo) {
  if (!modo || modo === '—') return 'Modalidade eletrônica conforme edital';
  const m = modo.toLowerCase();
  if (m.includes('aberto') && m.includes('fechado')) return 'Fase aberta de lances públicos seguida de lance final secreto por empresa';
  if (m.includes('aberto'))  return 'Lances abertos e visíveis a todos os participantes em tempo real';
  if (m.includes('fechado')) return 'Proposta única e sigilosa enviada por cada empresa, sem visibilidade dos concorrentes';
  return modo;
}

function gerarFases(modo) {
  if (!modo || modo === '—') return [];
  const m = modo.toLowerCase();
  if (m.includes('aberto') && m.includes('fechado')) {
    return [
      { n: '1', titulo: 'Fase Aberta', tempo: 'Lances públicos', desc: 'As empresas dão lances com valores visíveis a todos os participantes.' },
      { n: '2', titulo: 'Encerramento', tempo: 'Sistema encerra', desc: 'O sistema encerra aleatoriamente entre 1 e 30 minutos após o prazo.' },
      { n: '3', titulo: 'Lance Final', tempo: 'Oportunidade única', desc: 'Cada empresa envia um lance secreto, melhor que seu menor lance aberto.' },
    ];
  }
  if (m.includes('aberto')) {
    return [
      { n: '1', titulo: 'Fase Aberta', tempo: 'Lances públicos', desc: 'As empresas dão lances com valores visíveis a todos os participantes.' },
      { n: '2', titulo: 'Melhor Proposta', tempo: 'Encerramento', desc: 'Vence a empresa com o menor lance válido ao encerrar o pregão.' },
    ];
  }
  return [];
}

function extrairMarcos(dtAbertura, dtSessao) {
  const marcos = [];
  if (dtAbertura) marcos.push({ data: fmtDate(dtAbertura), label: 'Abertura Propostas' });
  if (dtSessao)   marcos.push({ data: fmtDate(dtSessao),   label: 'Sessão Disputa' });
  marcos.push({ data: 'Após disputa', label: 'Resultado' });
  marcos.push({ data: 'A definir',    label: 'Assinatura' });
  return marcos.slice(0, 4);
}

// ── Componentes de layout ─────────────────────────────────────────────────────

function drawHeader(doc, orgao, modalidade, numero) {
  // Fundo navy 80px
  doc.rect(0, 0, PW, 80).fill(NAVY);

  // Logo "7C conlicit"
  doc.font('Helvetica-Bold').fontSize(20).fillColor(WHITE).text('7C', ML, 22);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(TEAL).text('conlicit', ML + 33, 22);

  // Direita: título em teal
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEAL)
     .text('ANÁLISE ESTRATÉGICA DE EDITAL', ML, 18, { align: 'right', width: CW + ML });

  // Direita: orgao · modal numero em branco
  const orgaoStr = trunc(fmt(orgao), 55);
  const ref = [modalidade && validStr(modalidade) ? modalidade : null,
               numero && validStr(numero) ? numero : null].filter(Boolean).join(' ');
  const sub = [orgaoStr !== '—' ? orgaoStr : null, ref || null].filter(Boolean).join(' · ');
  doc.font('Helvetica').fontSize(8).fillColor(WHITE)
     .text(sub, ML, 36, { align: 'right', width: CW + ML });

  // Linha teal separadora
  doc.rect(0, 80, PW, 2).fill(TEAL);
}

function drawHeaderCompacto(doc) {
  doc.rect(0, 0, PW, 40).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(WHITE).text('7C', ML, 12);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(TEAL).text('conlicit', ML + 24, 12);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(TEAL)
     .text('MECÂNICA DA DISPUTA & PONTOS DE ATENÇÃO', ML, 26, { align: 'right', width: CW + ML });
  doc.rect(0, 40, PW, 2).fill(TEAL);
}

function drawFooter(doc, pageNum, portal) {
  const fy = PH - 22;
  doc.rect(0, fy, PW, 22).fill(NAVY);
  const left = portal && portal !== '—' ? `Plataforma: ${portal}` : 'Conlicit — Hub de Licitações';
  doc.font('Helvetica').fontSize(7).fillColor(WHITE)
     .text(left, ML, fy + 7, { width: CW * 0.5 });
  doc.font('Helvetica-Bold').fontSize(7).fillColor(TEAL)
     .text(`Análise preparada pela Conlicit · conlicit.com  |  Pág. ${pageNum}`,
           ML, fy + 7, { align: 'right', width: CW + ML });
}

function drawSectionTitle(doc, label, y) {
  doc.font('Helvetica-Bold').fontSize(8).fillColor(TEAL).text(label, ML, y);
  return y + 14;
}

function drawMetricCard(doc, x, y, w, h, label, value, detail) {
  doc.roundedRect(x, y, w, h, 4).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TEAL)
     .text(label, x + 10, y + 10, { width: w - 20, lineBreak: false, ellipsis: true });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(WHITE)
     .text(trunc(value, 26), x + 10, y + 24, { width: w - 20, lineBreak: false, ellipsis: true });
  if (detail && detail !== '—') {
    doc.font('Helvetica').fontSize(8).fillColor('#AACCDD')
       .text(trunc(detail, 50), x + 10, y + 44, { width: w - 20, lineBreak: false, ellipsis: true });
  }
}

// ── Gerador principal ─────────────────────────────────────────────────────────

async function gerarRelatorioSimplesPDF({ analise, pregao }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: false,
      compress: false,
      info: { Title: 'Análise Estratégica de Edital — Conlicit' },
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Parsear campos ──
    const riscos    = parseJSON(analise.riscos,    []);
    const checklist = parseJSON(analise.checklist, {});
    const chkAntes  = Array.isArray(checklist.antes)   ? checklist.antes   : [];
    const chkDur    = Array.isArray(checklist.durante)  ? checklist.durante : [];
    const todosChk  = [...chkAntes, ...chkDur].filter(Boolean).slice(0, 8);

    // ── Campos base ──
    const orgao      = fmt(pregao.orgao    || analise.orgao);
    const objeto     = fmt(pregao.objeto   || analise.objeto || analise.referencia);
    const numero     = fmt(pregao.numero   || analise.pregao_numero);
    const uf         = fmt(pregao.uf       || analise.uf);
    const portal     = fmt(pregao.portal_disputa);
    const modalidade = validStr(analise.modalidade) ? analise.modalidade : '—';
    const modoDisp   = validStr(analise.modo_disputa)  ? analise.modo_disputa  : '—';
    const tipoJulg   = validStr(analise.tipo_julgamento) ? analise.tipo_julgamento : 'Menor Preço';
    const valorEst   = fmtBRL(pregao.valor_estimado);
    const dtAbertura = pregao.data_abertura;
    const dtSessao   = pregao.data_hora_abertura;
    const dtData     = fmtDate(dtSessao || dtAbertura);
    const hora       = fmtHora(dtSessao);
    const abDetail   = [hora || null, portal !== '—' ? portal : null].filter(Boolean).join(' · ') || '—';
    const marcos     = extrairMarcos(dtAbertura, dtSessao);
    const fases      = gerarFases(modoDisp);

    // ================================================================
    // PÁGINA 1
    // ================================================================

    drawHeader(doc, orgao, modalidade, numero);

    let y = 90;

    // Subtítulo modalidade em teal caps
    doc.font('Helvetica-Bold').fontSize(8).fillColor(TEAL)
       .text(`${validStr(modalidade) ? modalidade.toUpperCase() : 'LICITAÇÃO'} · LEI 14.133/2021`, ML, y);
    y += 14;

    // Objeto principal em bold grande
    const objetoTxt = trunc(objeto, 160);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(BLACK)
       .text(objetoTxt, ML, y, { width: CW });
    doc.font('Helvetica-Bold').fontSize(20);
    y += doc.heightOfString(objetoTxt, { width: CW }) + 6;

    // Órgão / UF
    const orgaoLine = [orgao !== '—' ? orgao : null, uf !== '—' ? uf : null].filter(Boolean).join(' — ');
    doc.font('Helvetica').fontSize(10).fillColor(GRAY)
       .text(orgaoLine, ML, y, { width: CW });
    y += 24;

    // ── 4 Cards métricas 2×2 ──────────────────────────────────────
    const cardW = 248;
    const cardH = 70;
    const cardGap = CW - cardW * 2;

    const cards = [
      { label: 'VALOR ESTIMADO · TETO',   val: valorEst,               detail: 'Valor máximo aceitável' },
      { label: 'ABERTURA DA SESSÃO',       val: dtData,                 detail: abDetail },
      { label: 'MODALIDADE · DISPUTA',     val: trunc(modalidade, 22),  detail: modoDisp },
      { label: 'REGIME / JULGAMENTO',      val: trunc(tipoJulg, 22),    detail: 'Critério de seleção' },
    ];
    cards.forEach((c, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx  = ML + col * (cardW + cardGap);
      const cy  = y + row * (cardH + 8);
      drawMetricCard(doc, cx, cy, cardW, cardH, c.label, c.val, c.detail);
    });
    y += (cardH + 8) * 2 + 14;

    // ── Objeto da licitação ───────────────────────────────────────
    y = drawSectionTitle(doc, 'OBJETO DA LICITAÇÃO', y);

    const objH = Math.min(doc.heightOfString(objeto, { width: CW - 14 }), 60);
    doc.rect(ML, y, 3, objH + 4).fill(TEAL);
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
       .text(trunc(objeto, 400), ML + 10, y, { width: CW - 14, height: objH + 4, ellipsis: true });
    y += objH + 18;

    // ── Marcos críticos ───────────────────────────────────────────
    if (y + 70 < PH - 30) {
      y = drawSectionTitle(doc, 'MARCOS CRÍTICOS DO CERTAME', y);

      const nPts  = marcos.length;
      const ptW   = CW / nPts;
      const lineY = y + 10;

      // Linha horizontal teal
      doc.rect(ML + ptW * 0.5, lineY, CW - ptW, 2).fill(TEAL);

      marcos.forEach((m, i) => {
        const cx = ML + ptW * 0.5 + i * ptW;
        doc.circle(cx, lineY + 1, 10).fill(NAVY);
        doc.circle(cx, lineY + 1, 10).strokeColor(TEAL).lineWidth(1.5).stroke();
        doc.font('Helvetica-Bold').fontSize(8).fillColor(TEAL)
           .text(String(i + 1), cx - 10, lineY - 5, { width: 20, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(7).fillColor(BLACK)
           .text(m.data, cx - ptW * 0.5 + 2, lineY + 16, { width: ptW - 4, align: 'center' });
        doc.font('Helvetica').fontSize(7).fillColor(GRAY)
           .text(m.label, cx - ptW * 0.5 + 2, lineY + 27, { width: ptW - 4, align: 'center' });
      });
    }

    drawFooter(doc, 1, portal !== '—' ? portal : null);

    // ================================================================
    // PÁGINA 2
    // ================================================================
    doc.addPage();
    drawHeaderCompacto(doc);
    let y2 = 52;

    // ── Como será disputado ───────────────────────────────────────
    y2 = drawSectionTitle(doc, 'COMO O CERTAME SERÁ DISPUTADO', y2);

    const modoDescTxt = descricaoDisputa(modoDisp);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(BLACK)
       .text(modoDescTxt, ML, y2, { width: CW });
    doc.font('Helvetica-Bold').fontSize(15);
    y2 += Math.min(doc.heightOfString(modoDescTxt, { width: CW }), 40) + 12;

    // Cards de fases (se aberto/fechado)
    if (fases.length > 0) {
      const fW = Math.floor((CW - (fases.length - 1) * 10) / fases.length);
      const fH = 80;
      fases.forEach((f, i) => {
        const fx = ML + i * (fW + 10);
        doc.roundedRect(fx, y2, fW, fH, 4).strokeColor(TEAL).lineWidth(1).stroke();
        doc.circle(fx + 16, y2 + 16, 10).fill(TEAL);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE)
           .text(f.n, fx + 16 - 10, y2 + 10, { width: 20, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
           .text(f.titulo, fx + 32, y2 + 9, { width: fW - 40 });
        doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
           .text(f.tempo, fx + 32, y2 + 21, { width: fW - 40 });
        doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
           .text(trunc(f.desc, 90), fx + 10, y2 + 40, { width: fW - 20 });
      });
      y2 += fH + 16;
    } else {
      y2 += 8;
    }

    // ── Pontos de atenção ─────────────────────────────────────────
    y2 = drawSectionTitle(doc, 'PONTOS DE ATENÇÃO', y2);

    const riscos4 = Array.isArray(riscos) ? riscos.slice(0, 4) : [];
    if (riscos4.length === 0) {
      riscos4.push({ nivel: 'Baixo', risco: 'Nenhum risco específico identificado nesta análise.', recomendacao: '' });
    }

    const pW   = (CW - 10) / 2;
    const pRowH = 70;

    riscos4.forEach((r, i) => {
      const col  = i % 2;
      const row  = Math.floor(i / 2);
      const px   = ML + col * (pW + 10);
      const py   = y2 + row * (pRowH + 8);
      const cor  = nivelCor(r.nivel);
      const nivel  = validStr(r.nivel)  ? r.nivel  : 'Atenção';
      const risco  = validStr(r.risco)  ? r.risco  : String(r);
      const rec    = validStr(r.recomendacao) ? r.recomendacao : '';

      doc.roundedRect(px, py, pW, pRowH, 3).strokeColor(cor).lineWidth(1.5).stroke();
      doc.font('Helvetica-Bold').fontSize(7).fillColor(cor)
         .text(nivel.toUpperCase(), px + 8, py + 8, { width: pW - 16 });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
         .text(trunc(risco, 60), px + 8, py + 20, { width: pW - 16, height: 18, ellipsis: true });
      if (rec) {
        doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
           .text(`Rec.: ${trunc(rec, 80)}`, px + 8, py + 42, { width: pW - 16, height: 20, ellipsis: true });
      }
    });

    y2 += Math.ceil(riscos4.length / 2) * (pRowH + 8) + 10;

    // ── Checklist pré-disputa ─────────────────────────────────────
    if (y2 + 80 < PH - 30 && todosChk.length > 0) {
      y2 = drawSectionTitle(doc, 'CHECKLIST PRÉ-DISPUTA', y2);

      const col1 = todosChk.slice(0, 4);
      const col2 = todosChk.slice(4, 8);
      const chW  = (CW - 20) / 2;

      [col1, col2].forEach((colItems, ci) => {
        let cy = y2;
        const cx = ML + ci * (chW + 20);
        colItems.forEach(item => {
          const txt = trunc(fmt(item), 90);
          doc.rect(cx, cy + 1, 8, 8).strokeColor(TEAL).lineWidth(1).stroke();
          doc.font('Helvetica').fontSize(8.5).fillColor(BLACK)
             .text(txt, cx + 14, cy, { width: chW - 14 });
          doc.font('Helvetica').fontSize(8.5);
          cy += Math.min(doc.heightOfString(txt, { width: chW - 14 }), 16) + 5;
        });
      });
    }

    drawFooter(doc, 2, portal !== '—' ? portal : null);

    doc.end();
  });
}

module.exports = { gerarRelatorioSimplesPDF };
