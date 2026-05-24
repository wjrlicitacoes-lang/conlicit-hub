const PDFDocument = require('pdfkit');

const NAVY   = '#182A39';
const TEAL   = '#4CC5D7';
const WHITE  = '#FFFFFF';
const BLACK  = '#080808';
const GRAY   = '#5F7A8A';
const GREEN  = '#38A169';
const ORANGE = '#DD6B20';
const RED    = '#E53E3E';

const PW  = 595.28;
const PH  = 841.89;
const ML  = 40;
const MR  = 40;
const CW  = PW - ML - MR;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v) { return (v == null || v === '') ? '—' : String(v); }

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
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch { return String(v); }
}

function fmtDateTime(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${data} as ${hora}`;
  } catch { return String(v); }
}

function trunc(str, max) {
  if (!str || str === '—') return str || '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function parseJSON(val, fallback) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'object' && val !== null) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return fallback;
}

function scoreColor(score) {
  if (score >= 70) return GREEN;
  if (score >= 40) return ORANGE;
  return RED;
}

// ── Componentes de layout ─────────────────────────────────────────────────────

function drawHeader(doc, orgao, modalidade, numero) {
  doc.rect(0, 0, PW, 60).fill(NAVY);

  // Logo "7C conlicit"
  doc.fillColor(WHITE).fontSize(14).font('Helvetica-Bold').text('7C', ML, 18);
  doc.fillColor(TEAL).fontSize(14).font('Helvetica-Bold').text('conlicit', ML + 26, 18);

  // Direita: titulo
  doc.fillColor(TEAL).fontSize(11).font('Helvetica-Bold')
     .text('ANALISE ESTRATEGICA DE EDITAL', 0, 14, { width: PW - ML, align: 'right' });

  // Direita: orgao · modal numero
  const orgaoStr = trunc(fmt(orgao), 55);
  const modalStr = [modalidade && modalidade !== '—' ? modalidade : null,
                    numero    && numero !== '—'    ? numero     : null]
                     .filter(Boolean).join(' ');
  const sub = [orgaoStr !== '—' ? orgaoStr : null, modalStr || null].filter(Boolean).join(' · ');
  doc.fillColor(WHITE).fontSize(8).font('Helvetica')
     .text(sub, 0, 33, { width: PW - ML, align: 'right' });

  // Linha turquesa separadora
  doc.rect(0, 60, PW, 2).fill(TEAL);
}

function drawHeaderCompacto(doc) {
  doc.rect(0, 0, PW, 30).fill(NAVY);
  doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold').text('7C', ML, 9);
  doc.fillColor(TEAL).fontSize(10).font('Helvetica-Bold').text('conlicit', ML + 20, 9);
  doc.fillColor(TEAL).fontSize(8).font('Helvetica-Bold')
     .text('ANALISE ESTRATEGICA DE EDITAL', 0, 10, { width: PW - ML, align: 'right' });
  doc.rect(0, 30, PW, 1).fill(TEAL);
}

function drawFooter(doc, pageNum, portal) {
  const fy = PH - 30;
  doc.rect(0, fy, PW, 30).fill(NAVY);
  const leftTxt = portal && portal !== '—'
    ? `Plataforma: ${portal}`
    : 'Conlicit — Hub de Licitacoes';
  doc.fillColor(WHITE).fontSize(7).font('Helvetica')
     .text(leftTxt, ML, fy + 11, { width: CW * 0.5 });
  doc.fillColor(TEAL).fontSize(7).font('Helvetica-Bold')
     .text(`Analise preparada pela Conlicit · conlicit.com  |  Pag. ${pageNum}`,
           0, fy + 11, { width: PW - ML, align: 'right' });
}

function drawMetricCard(doc, x, y, w, h, label, value, detail) {
  doc.roundedRect(x, y, w, h, 4).fill(NAVY);
  doc.fillColor(TEAL).fontSize(7.5).font('Helvetica-Bold')
     .text(label, x + 10, y + 10, { width: w - 20, lineBreak: false });
  doc.fillColor(WHITE).fontSize(14).font('Helvetica-Bold')
     .text(trunc(value, 28), x + 10, y + 24, { width: w - 20, lineBreak: false, ellipsis: true });
  if (detail && detail !== '—') {
    doc.fillColor(WHITE).fontSize(8).font('Helvetica')
       .text(trunc(detail, 55), x + 10, y + 43, { width: w - 20, lineBreak: false, ellipsis: true });
  }
}

function drawSectionLabel(doc, label, y) {
  doc.rect(ML, y, CW, 1).fill(TEAL);
  doc.fillColor(TEAL).fontSize(8).font('Helvetica-Bold')
     .text(label, ML, y + 6);
  return y + 20;
}

// ── Gerador principal ─────────────────────────────────────────────────────────

async function gerarRelatorioSimplesPDF({ analise, pregao }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: false,
      compress: false,
      info: { Title: 'Analise Estrategica de Edital — Conlicit' },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Parsear campos complexos ──
    const riscos     = parseJSON(analise.riscos,     []);
    const checklist  = parseJSON(analise.checklist,  {});
    const checklistA = Array.isArray(checklist.antes)   ? checklist.antes   : [];
    const checklistD = Array.isArray(checklist.durante) ? checklist.durante : [];
    const todosCheck = [...checklistA, ...checklistD].filter(Boolean).slice(0, 8);

    // ── Campos base ──
    const orgao      = fmt(pregao.orgao   || analise.orgao);
    const objeto     = fmt(pregao.objeto  || analise.objeto || analise.referencia);
    const numero     = fmt(pregao.numero  || analise.pregao_numero);
    const uf         = fmt(pregao.uf      || analise.uf);
    const portal     = fmt(pregao.portal_disputa);
    const modalidade = fmt(analise.modalidade);
    const modoDisp   = fmt(analise.modo_disputa);
    const tipoJulg   = fmt(analise.tipo_julgamento);
    const valorEst   = fmtBRL(pregao.valor_estimado);
    const dtAbertura = fmtDateTime(pregao.data_hora_abertura || pregao.data_abertura);
    const dtDate     = fmtDate(pregao.data_hora_abertura     || pregao.data_abertura);

    // =====================================================================
    // PÁGINA 1
    // =====================================================================

    drawHeader(doc, orgao, modalidade, numero);

    // ── Título e subtítulo ──
    const tituloY = 70;
    const objetoTxt = trunc(objeto, 220);
    doc.fillColor(BLACK).fontSize(20).font('Helvetica-Bold')
       .text(objetoTxt, ML, tituloY, { width: CW });
    doc.fontSize(20).font('Helvetica-Bold'); // set before heightOfString
    const tituloH = doc.heightOfString(objetoTxt, { width: CW });

    const subtY = tituloY + tituloH + 5;
    const subtTxt = [orgao !== '—' ? orgao : null, uf !== '—' ? uf : null].filter(Boolean).join(' · ');
    doc.fillColor(GRAY).fontSize(11).font('Helvetica')
       .text(subtTxt, ML, subtY, { width: CW });

    // ── 4 Cards métricas 2x2 ──
    const gapCard = 10;
    const cardW   = (CW - gapCard) / 2;
    const cardH   = 62;
    const cardsY  = subtY + 28;

    // Detalhe do card de abertura: hora + portal
    const dtParts = dtAbertura.split(' ');
    const dtHora  = dtParts.length >= 3 ? dtParts.slice(2).join(' ') : '';
    const abDetail = [dtHora || null, portal !== '—' ? portal : null].filter(Boolean).join(' · ') || '—';

    const cards = [
      { label: 'VALOR ESTIMADO · TETO',    val: valorEst,              detail: 'Valor maximo aceitavel' },
      { label: 'ABERTURA DA SESSAO',        val: dtDate,               detail: abDetail },
      { label: 'MODALIDADE · DISPUTA',      val: trunc(modalidade, 24), detail: modoDisp },
      { label: 'REGIME / JULGAMENTO',       val: trunc(tipoJulg, 24),  detail: 'Criterio de selecao' },
    ];

    cards.forEach((c, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx  = ML + col * (cardW + gapCard);
      const cy  = cardsY + row * (cardH + 8);
      drawMetricCard(doc, cx, cy, cardW, cardH, c.label, c.val, c.detail);
    });

    // ── Seção: Objeto da licitação ──
    const objSecY = cardsY + (cardH + 8) * 2 + 14;
    let y = drawSectionLabel(doc, 'ESCOPO RESUMIDO', objSecY);

    const objTxt = trunc(objeto, 500);
    doc.fontSize(10).font('Helvetica');
    const objH = doc.heightOfString(objTxt, { width: CW - 14 });
    // Borda teal à esquerda (estilo blockquote)
    doc.rect(ML, y, 3, objH + 4).fill(TEAL);
    doc.fillColor(BLACK).fontSize(10).font('Helvetica')
       .text(objTxt, ML + 14, y, { width: CW - 14 });
    y += objH + 18;

    // ── Timeline: Marcos críticos ──
    if (y + 80 < PH - 50) {
      y = drawSectionLabel(doc, 'MARCOS CRITICOS DO CERTAME', y);

      const milestones = [];
      if (pregao.data_abertura && pregao.data_abertura !== pregao.data_hora_abertura) {
        milestones.push({ n: '1', data: fmtDate(pregao.data_abertura), label: 'Abertura Propostas' });
      } else {
        milestones.push({ n: '1', data: 'Ver edital', label: 'Publicacao' });
      }
      if (pregao.data_hora_abertura) {
        milestones.push({ n: String(milestones.length + 1), data: dtDate, label: 'Sessao Disputa' });
      }
      milestones.push({ n: String(milestones.length + 1), data: 'Apos disputa', label: 'Resultado' });
      milestones.push({ n: String(milestones.length + 1), data: 'Estimado', label: 'Contrato' });

      const nPts = Math.min(milestones.length, 5);
      const ptW  = CW / nPts;
      const lineY = y + 12;

      // Linha horizontal
      doc.rect(ML + ptW * 0.5, lineY, CW - ptW, 2).fill(TEAL);

      milestones.slice(0, nPts).forEach((m, i) => {
        const cx = ML + ptW * 0.5 + i * ptW;
        // Círculo
        doc.circle(cx, lineY + 1, 10).fill(TEAL);
        doc.fillColor(WHITE).fontSize(8).font('Helvetica-Bold')
           .text(m.n, cx - 10, lineY - 5, { width: 20, align: 'center' });
        // Data e label
        doc.fillColor(BLACK).fontSize(7).font('Helvetica-Bold')
           .text(m.data, cx - ptW * 0.5 + 2, lineY + 16, { width: ptW - 4, align: 'center' });
        doc.fillColor(GRAY).fontSize(7).font('Helvetica')
           .text(m.label, cx - ptW * 0.5 + 2, lineY + 27, { width: ptW - 4, align: 'center' });
      });
    }

    drawFooter(doc, 1, portal !== '—' ? portal : null);

    // =====================================================================
    // PÁGINA 2
    // =====================================================================
    doc.addPage();
    drawHeaderCompacto(doc);

    let y2 = 45;

    // ── Seção: Como o certame será disputado ──
    y2 = drawSectionLabel(doc, 'COMO O CERTAME SERA DISPUTADO', y2);

    const modoDesc = modoDisp !== '—' ? modoDisp : 'Modalidade eletronica';
    doc.fillColor(BLACK).fontSize(17).font('Helvetica-Bold')
       .text(modoDesc, ML, y2, { width: CW });
    doc.fontSize(17).font('Helvetica-Bold');
    y2 += doc.heightOfString(modoDesc, { width: CW }) + 12;

    // Cards de fases (se for aberto/fechado)
    const temFases = modoDisp.toLowerCase().includes('aberto') || modoDisp.toLowerCase().includes('fechado');
    if (temFases) {
      const fases = [
        {
          n: '1', titulo: 'Fase Aberta',
          tempo: 'Lances publicos',
          desc: 'As empresas dao lances com valores visiveis a todos os participantes.',
        },
        {
          n: '2', titulo: 'Fechamento Aleatorio',
          tempo: 'Sistema encerra',
          desc: 'O sistema encerra entre 1 e 30 minutos apos o prazo, aleatoriamente.',
        },
        {
          n: '3', titulo: 'Lance Final Fechado',
          tempo: 'Oportunidade unica',
          desc: 'Cada empresa envia um lance secreto, maior que o menor lance aberto.',
        },
      ];
      const fW = (CW - 16) / 3;
      const fH = 78;
      fases.forEach((f, i) => {
        const fx = ML + i * (fW + 8);
        doc.roundedRect(fx, y2, fW, fH, 4).strokeColor(TEAL).lineWidth(1).stroke();
        // Numero em circulo
        doc.circle(fx + 18, y2 + 16, 10).fill(TEAL);
        doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
           .text(f.n, fx + 18 - 10, y2 + 10, { width: 20, align: 'center' });
        doc.fillColor(BLACK).fontSize(8.5).font('Helvetica-Bold')
           .text(f.titulo, fx + 34, y2 + 9, { width: fW - 44 });
        doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
           .text(f.tempo, fx + 34, y2 + 21, { width: fW - 44 });
        doc.fillColor(BLACK).fontSize(7.5).font('Helvetica')
           .text(f.desc, fx + 10, y2 + 38, { width: fW - 20 });
      });
      y2 += fH + 16;
    } else {
      y2 += 8;
    }

    // ── Seção: Pontos de atenção ──
    y2 = drawSectionLabel(doc, 'PONTOS DE ATENCAO', y2);

    const pontosRaw = riscos.slice(0, 4).map(r => {
      if (typeof r === 'string') return { titulo: 'Atencao', desc: r };
      return {
        titulo: fmt(r.tipo || r.titulo || r.category || 'Atencao'),
        desc:   fmt(r.descricao || r.description || r.detail || JSON.stringify(r)),
      };
    });
    if (pontosRaw.length === 0) {
      pontosRaw.push({ titulo: 'SEM RISCOS IDENTIFICADOS', desc: 'Nenhum risco especifico foi identificado nesta analise.' });
    }

    const pW  = (CW - 10) / 2;
    const pRowH = 68;
    for (let i = 0; i < pontosRaw.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const px  = ML + col * (pW + 10);
      const py  = y2 + row * (pRowH + 8);
      doc.fillColor(TEAL).fontSize(7.5).font('Helvetica-Bold')
         .text(trunc(pontosRaw[i].titulo, 50).toUpperCase(), px, py, { width: pW });
      doc.fillColor(BLACK).fontSize(8.5).font('Helvetica')
         .text(trunc(pontosRaw[i].desc, 200), px, py + 14, { width: pW, height: pRowH - 14, ellipsis: true });
    }
    const nRows = Math.ceil(pontosRaw.length / 2);
    y2 += nRows * (pRowH + 8) + 12;

    // ── Seção: Checklist pré-disputa ──
    if (y2 < PH - 130 && todosCheck.length > 0) {
      y2 = drawSectionLabel(doc, 'CHECKLIST PRE-DISPUTA', y2);

      const col1 = todosCheck.slice(0, 4);
      const col2 = todosCheck.slice(4, 8);
      const chW  = (CW - 20) / 2;

      [col1, col2].forEach((colItems, ci) => {
        let cy = y2;
        const cx = ML + ci * (chW + 20);
        colItems.forEach((item) => {
          const txt = trunc(fmt(item), 100);
          // Checkbox vazio
          doc.rect(cx, cy + 1, 8, 8).strokeColor(TEAL).lineWidth(1).stroke();
          doc.fillColor(BLACK).fontSize(8.5).font('Helvetica')
             .text(txt, cx + 14, cy, { width: chW - 14 });
          doc.fontSize(8.5).font('Helvetica');
          cy += doc.heightOfString(txt, { width: chW - 14 }) + 6;
        });
      });
    }

    drawFooter(doc, 2, portal !== '—' ? portal : null);

    doc.end();
  });
}

module.exports = { gerarRelatorioSimplesPDF };
