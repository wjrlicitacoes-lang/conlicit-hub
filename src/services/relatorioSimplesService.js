const PDFDocument = require('pdfkit');

const NAVY = '#182A39';
const TEAL = '#4CC5D7';
const WHITE = '#FFFFFF';
const DARK  = '#1A1A2E';
const MID   = '#5F7A8A';
const GREEN  = '#38A169';
const ORANGE = '#DD6B20';
const RED    = '#E53E3E';

function scoreLabel(score) {
  if (score >= 70) return 'Alta';
  if (score >= 40) return 'Regular';
  return 'Baixa';
}

function scoreColor(score) {
  if (score >= 70) return GREEN;
  if (score >= 40) return ORANGE;
  return RED;
}

function fmt(v) {
  if (v == null) return '—';
  return String(v);
}

function fmtBRL(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
  catch { return String(v); }
}

async function gerarRelatorioSimplesPDF({ analise, pregao }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: false,
      compress: false,
      info: { Title: 'Oportunidade de Licitacao — Conlicit' },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width;
    const PH = doc.page.height;
    const ML = 45;
    const MR = 45;
    const CW = PW - ML - MR;

    // ── HEADER NAVY ──────────────────────────────────────────────
    doc.rect(0, 0, PW, 90).fill(NAVY);

    // Logo texto
    doc.fillColor(TEAL).fontSize(20).font('Helvetica-Bold')
      .text('conlicit', ML, 22);
    doc.fillColor(WHITE).fontSize(9).font('Helvetica')
      .text('hub.conlicit.com', ML, 46);

    // Título direito
    doc.fillColor(WHITE).fontSize(14).font('Helvetica-Bold')
      .text('Oportunidade de Licitação', ML, 22, { width: CW, align: 'right' });
    doc.fillColor(TEAL).fontSize(9).font('Helvetica')
      .text('Análise preparada pela Conlicit', ML, 46, { width: CW, align: 'right' });

    // ── SUB-HEADER: órgão + número ────────────────────────────────
    doc.rect(0, 90, PW, 36).fill('#0f1e29');
    doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold')
      .text(fmt(pregao.orgao || analise.orgao), ML, 98, { width: CW * 0.7, ellipsis: true, lineBreak: false });
    doc.fillColor(TEAL).fontSize(9).font('Helvetica')
      .text(fmt(pregao.numero || analise.pregao_numero || '—'), ML, 113, { width: CW * 0.7 });
    doc.fillColor(MID).fontSize(8).font('Helvetica')
      .text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}`, ML, 113, { width: CW, align: 'right' });

    // ── SCORE BOX ─────────────────────────────────────────────────
    const sc = analise.score ?? 0;
    const scColor = scoreColor(sc);
    const scLabel = scoreLabel(sc);
    const boxX = PW - ML - 90;
    doc.rect(boxX, 98, 90, 52).fill(scColor);
    doc.fillColor(WHITE).fontSize(28).font('Helvetica-Bold')
      .text(String(sc), boxX, 103, { width: 90, align: 'center' });
    doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
      .text(scLabel, boxX, 133, { width: 90, align: 'center' });

    // ── OBJETO ────────────────────────────────────────────────────
    const objetoText = fmt(pregao.objeto || analise.objeto).slice(0, 220);
    doc.fillColor(MID).fontSize(8).font('Helvetica-Oblique')
      .text(objetoText, ML, 130, { width: CW - 100, height: 24, ellipsis: true });

    // ── 4 INFO CARDS ──────────────────────────────────────────────
    const cardY = 160;
    const cardH = 52;
    const cardW = (CW - 12) / 4;
    const modalDisp = [analise.modalidade, analise.modo_disputa].filter(Boolean).join(' · ') || '—';
    const cards = [
      { icon: '$',    label: 'Valor estimado', val: fmtBRL(pregao.valor_estimado) },
      { icon: 'DATA', label: 'Data da sessao',  val: fmtDate(pregao.data_hora_abertura || pregao.data_abertura) },
      { icon: 'MOD.', label: 'Modalidade',      val: modalDisp },
      { icon: 'UF',   label: 'Local',           val: fmt(pregao.uf || analise.uf || '—') },
    ];

    cards.forEach((c, i) => {
      const cx = ML + i * (cardW + 4);
      doc.rect(cx, cardY, cardW, cardH).fill('#F0F4F8').stroke('#D4DCE4');
      doc.fillColor(TEAL).fontSize(14).font('Helvetica')
        .text(c.icon, cx + 6, cardY + 6, { width: cardW - 12 });
      doc.fillColor(MID).fontSize(7.5).font('Helvetica')
        .text(c.label, cx + 6, cardY + 22, { width: cardW - 12 });
      doc.fillColor(DARK).fontSize(8.5).font('Helvetica-Bold')
        .text(c.val, cx + 6, cardY + 33, { width: cardW - 12, lineBreak: false, ellipsis: true });
    });

    // ── POR QUE PARTICIPAR ────────────────────────────────────────
    const sect1Y = cardY + cardH + 14;
    doc.rect(ML, sect1Y, CW, 16).fill(NAVY);
    doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
      .text('Por que participar', ML + 8, sect1Y + 3, { width: CW - 16 });

    const justText = fmt(analise.score_justificativa).split('\n').slice(0, 4).join(' ').slice(0, 600);
    doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
      .text(justText || fmt(analise.resumo_executivo).slice(0, 600),
        ML, sect1Y + 20, { width: CW, height: 68, ellipsis: true });

    // ── ITENS SIMPLIFICADOS ────────────────────────────────────────
    const sect2Y = sect1Y + 98;
    doc.rect(ML, sect2Y, CW, 16).fill(NAVY);
    doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
      .text('Itens principais', ML + 8, sect2Y + 3, { width: CW - 16 });

    const itens = (Array.isArray(analise.itens) ? analise.itens : []).slice(0, 5);
    if (itens.length === 0) {
      doc.fillColor(MID).fontSize(8).font('Helvetica-Oblique')
        .text('Itens não disponíveis nesta análise.', ML, sect2Y + 22, { width: CW });
    } else {
      // Table header
      const thY = sect2Y + 20;
      doc.rect(ML, thY, CW, 14).fill(TEAL);
      doc.fillColor(WHITE).fontSize(7.5).font('Helvetica-Bold')
        .text('#', ML + 4, thY + 3, { width: 20 });
      doc.fillColor(WHITE).fontSize(7.5).font('Helvetica-Bold')
        .text('Descrição', ML + 28, thY + 3, { width: CW - 70 });
      doc.fillColor(WHITE).fontSize(7.5).font('Helvetica-Bold')
        .text('Qtd', ML + CW - 40, thY + 3, { width: 38, align: 'right' });

      itens.forEach((item, idx) => {
        const rowY = thY + 14 + idx * 13;
        const bg = idx % 2 === 0 ? '#F8FAFB' : WHITE;
        doc.rect(ML, rowY, CW, 13).fill(bg);
        doc.fillColor(DARK).fontSize(7.5).font('Helvetica')
          .text(String(item.numero ?? idx + 1), ML + 4, rowY + 2, { width: 20 });
        doc.fillColor(DARK).fontSize(7.5).font('Helvetica')
          .text(fmt(item.descricao), ML + 28, rowY + 2, {
            width: CW - 70, lineBreak: false, ellipsis: true,
          });
        doc.fillColor(DARK).fontSize(7.5).font('Helvetica')
          .text(fmt(item.quantidade), ML + CW - 40, rowY + 2, { width: 38, align: 'right' });
      });
    }

    // ── PRÓXIMOS PASSOS ────────────────────────────────────────────
    const passosY = sect2Y + 120;
    doc.rect(ML, passosY, CW, 16).fill(NAVY);
    doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
      .text('Próximos passos', ML + 8, passosY + 3, { width: CW - 16 });

    const checklist = typeof analise.checklist === 'string'
      ? JSON.parse(analise.checklist)
      : (analise.checklist || {});
    const checklistAntes  = Array.isArray(checklist.antes)   ? checklist.antes.slice(0, 3)  : [];
    const checklistDur    = Array.isArray(checklist.durante) ? checklist.durante.slice(0, 1) : [];
    const passos          = [...checklistAntes, ...checklistDur].slice(0, 3);

    if (passos.length === 0) {
      doc.fillColor(MID).fontSize(8).font('Helvetica-Oblique')
        .text('Checklist não disponível.', ML, passosY + 22, { width: CW });
    } else {
      let passoY = passosY + 22;
      passos.forEach((p) => {
        doc.rect(ML, passoY, 12, 12).strokeColor(TEAL).stroke();
        const txt = fmt(p).slice(0, 180);
        const textH = doc.heightOfString(txt, { width: CW - 22, fontSize: 8.5 });
        doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
          .text(txt, ML + 18, passoY + 1, { width: CW - 22 });
        passoY += Math.max(textH + 6, 18);
      });
    }

    // ── FOOTER ────────────────────────────────────────────────────
    const footerY = PH - 36;
    doc.rect(0, footerY, PW, 36).fill(NAVY);
    doc.fillColor(TEAL).fontSize(8).font('Helvetica-Bold')
      .text('Análise preparada pela Conlicit', ML, footerY + 8, { width: CW });
    doc.fillColor(WHITE).fontSize(7.5).font('Helvetica')
      .text(`conlicit.com  ·  ${new Date().toLocaleDateString('pt-BR')}`, ML, footerY + 21, { width: CW });
    doc.fillColor(MID).fontSize(7).font('Helvetica-Oblique')
      .text('Documento confidencial — preparado exclusivamente para fins comerciais', ML, footerY + 8, { width: CW, align: 'right' });

    doc.end();
  });
}

module.exports = { gerarRelatorioSimplesPDF };
