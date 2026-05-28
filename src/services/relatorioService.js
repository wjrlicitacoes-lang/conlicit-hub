const PDFDocument = require('pdfkit');

const NAVY = '#182A39';
const TEAL = '#4CC5D7';
const GRAY = '#F5F7FA';
const DARK = '#1A1A2E';
const MID  = '#4A5568';
const RED  = '#E53E3E';
const ORANGE = '#DD6B20';
const GREEN  = '#38A169';

function scoreColor(score) {
  if (score >= 80) return GREEN;
  if (score >= 60) return TEAL;
  if (score >= 40) return ORANGE;
  return RED;
}

function scoreLabel(score) {
  if (score >= 80) return 'Excelente';
  if (score >= 60) return 'Bom';
  if (score >= 40) return 'Regular';
  if (score >= 20) return 'Difícil';
  return 'Não recomendado';
}

function nivelColor(nivel) {
  if (!nivel) return MID;
  const n = nivel.toLowerCase();
  if (n === 'alto') return RED;
  if (n === 'médio' || n === 'medio') return ORANGE;
  return GREEN;
}

function fmt(v) {
  if (v === null || v === undefined) return '—';
  return String(v);
}

function fmtBRL(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); }
  catch { return String(v); }
}

async function gerarRelatorioPDF({ analise, pregao, cliente }) {
  // Campos com fallback em múltiplas fontes (analise, pregao, raw)
  const raw = analise.raw ?? analise.dados_json ?? {};

  const orgao = analise.pregao_orgao
    ?? analise.orgao
    ?? pregao?.orgao
    ?? raw.orgaoEntidade?.razaoSocial
    ?? raw.orgao_nome
    ?? '—';

  const valorEstimado = analise.pregao_valor_estimado
    ?? analise.valor_estimado
    ?? pregao?.valor_estimado
    ?? raw.valorTotalEstimado
    ?? raw.valor_estimado
    ?? null;

  const dataAbertura = analise.data_hora_abertura
    ?? analise.pregao_data_abertura
    ?? analise.data_abertura
    ?? pregao?.data_hora_abertura
    ?? pregao?.data_abertura
    ?? raw.dataAberturaProposta
    ?? null;

  const uf = analise.cliente_uf
    ?? analise.uf
    ?? cliente?.uf
    ?? raw.unidadeOrgao?.ufSigla
    ?? '—';

  const numeroEdital = analise.pregao_numero
    ?? analise.numero
    ?? pregao?.numero
    ?? analise.referencia
    ?? '—';

  const objeto = analise.pregao_objeto
    ?? analise.objeto
    ?? pregao?.objeto
    ?? analise.referencia
    ?? '—';

  const clienteNome = analise.cliente_nome ?? cliente?.nome ?? pregao?.cliente_nome ?? '—';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 50, right: 50 },
      bufferPages: true,
      info: {
        Title: `Relatório Edson — Pregão ${numeroEdital}`,
        Author: 'ConlicitHub — Edson IA',
      },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width;
    const ML = doc.page.margins.left;
    const MR = doc.page.margins.right;
    const CW = PW - ML - MR; // content width

    // ── Helpers ───────────────────────────────────────────────────

    function addPageHeader() {
      const y0 = 20;
      doc.rect(0, y0, PW, 28).fill(NAVY);
      doc.fillColor('white').fontSize(8).font('Helvetica')
        .text(`ConlicitHub — Análise Edson IA   |   Pregão ${numeroEdital}   |   ${new Date().toLocaleDateString('pt-BR')}`,
          ML, y0 + 8, { width: CW - 60, align: 'left' });
    }

    function pageNum() {
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.fillColor(MID).fontSize(8).font('Helvetica')
          .text(`Página ${i + 1} de ${range.count}`, ML, doc.page.height - 38,
            { width: CW, align: 'right' });
      }
    }

    function sectionTitle(title) {
      doc.moveDown(0.5);
      const y = doc.y;
      doc.rect(ML, y, CW, 22).fill(NAVY);
      doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
        .text(title, ML + 10, y + 5, { width: CW - 20 });
      doc.moveDown(0.3);
    }

    function kv(label, value, opts = {}) {
      const rowH = opts.tall ? 30 : 18;
      const y = doc.y;
      doc.rect(ML, y, CW * 0.35, rowH).fill('#E2E8F0');
      doc.rect(ML + CW * 0.35, y, CW * 0.65, rowH).fill(GRAY);
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica-Bold')
        .text(label, ML + 6, y + 4, { width: CW * 0.35 - 10 });
      doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
        .text(fmt(value), ML + CW * 0.35 + 6, y + 4, { width: CW * 0.65 - 10 });
      doc.y = y + rowH + 1;
    }

    function checkSpace(needed) {
      if (doc.y + needed > doc.page.height - 80) {
        doc.addPage();
        addPageHeader();
        doc.y = 65;
      }
    }

    // ══════════════════════════════════════════════════════════════
    // COVER PAGE
    // ══════════════════════════════════════════════════════════════

    // Navy top bar
    doc.rect(0, 0, PW, 180).fill(NAVY);

    doc.fillColor(TEAL).fontSize(22).font('Helvetica-Bold')
      .text('RELATÓRIO DE ANÁLISE', ML, 40, { width: CW });
    doc.fillColor('white').fontSize(14).font('Helvetica')
      .text('Edson IA — ConlicitHub', ML, 68, { width: CW });

    // Score box
    const sc = analise.score ?? null;
    const scColor = sc != null ? scoreColor(sc) : MID;
    doc.rect(PW - 130, 30, 90, 90).fill(scColor);
    doc.fillColor('white').fontSize(36).font('Helvetica-Bold')
      .text(sc != null ? String(sc) : '—', PW - 130, 38, { width: 90, align: 'center' });
    doc.fillColor('white').fontSize(10).font('Helvetica')
      .text(sc != null ? scoreLabel(sc) : '—', PW - 130, 82, { width: 90, align: 'center' });
    doc.fillColor('white').fontSize(8).font('Helvetica')
      .text('/ 100', PW - 130, 100, { width: 90, align: 'center' });

    // Pregão details block
    doc.rect(ML, 180, CW, 80).fill('#EBF4F8');
    doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold')
      .text(`Nº Pregão: ${fmt(numeroEdital)}`, ML + 12, 192)
      .text(`Órgão: ${fmt(orgao)}`, ML + 12, 207)
      .text(`Modalidade: ${fmt(analise.modalidade)}   |   Modo de disputa: ${fmt(analise.modo_disputa)}`, ML + 12, 222)
      .text(`Data de abertura: ${fmtDate(dataAbertura)}   |   Valor estimado: ${fmtBRL(valorEstimado)}`, ML + 12, 237);

    doc.fillColor(MID).fontSize(8.5).font('Helvetica')
      .text(`Cliente: ${fmt(clienteNome)}   |   UF: ${fmt(uf)}`, ML + 12, 252);

    // Objeto
    doc.y = 275;
    doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text('Objeto:', ML);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
      .text(fmt(objeto), ML, doc.y + 2, { width: CW });

    // Gerado em
    doc.fillColor(MID).fontSize(8).font('Helvetica')
      .text(`Relatório gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — Powered by Claude AI (Anthropic)`,
        ML, doc.page.height - 60, { width: CW, align: 'center' });

    // ══════════════════════════════════════════════════════════════
    // PAGE 2: RESUMO EXECUTIVO
    // ══════════════════════════════════════════════════════════════
    doc.addPage();
    addPageHeader();
    doc.y = 65;

    sectionTitle('1. Resumo Executivo');
    doc.moveDown(0.3);
    kv('Número do pregão', numeroEdital);
    kv('Órgão', orgao);
    kv('Modalidade', analise.modalidade);
    kv('Modo de disputa', analise.modo_disputa);
    kv('Tipo de julgamento', analise.tipo_julgamento);
    kv('Valor estimado', fmtBRL(valorEstimado));
    kv('Data de abertura', fmtDate(dataAbertura));
    kv('Score de oportunidade', sc != null ? `${sc}/100 — ${scoreLabel(sc)}` : '—');

    doc.moveDown(0.5);
    doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text('Justificativa do Score:', ML);
    doc.moveDown(0.2);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
      .text(fmt(analise.score_justificativa), ML, doc.y, { width: CW, align: 'justify' });

    doc.moveDown(0.5);
    doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text('Análise Executiva:', ML);
    doc.moveDown(0.2);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
      .text(fmt(analise.resumo_executivo), ML, doc.y, { width: CW, align: 'justify' });

    // ══════════════════════════════════════════════════════════════
    // SECTION 2: ITENS
    // ══════════════════════════════════════════════════════════════
    const itens = Array.isArray(analise.itens) ? analise.itens : [];
    if (itens.length > 0) {
      checkSpace(60);
      doc.moveDown(0.8);
      sectionTitle('2. Itens do Pregão');
      doc.moveDown(0.3);

      // Table header
      const cols = [30, 200, 55, 50, 80, 55];
      const labels = ['Nº', 'Descrição', 'Unidade', 'Qtd', 'Vr Unit. Est.', 'Vr Total Est.'];
      const y0 = doc.y;
      doc.rect(ML, y0, CW, 18).fill(TEAL);
      let x = ML;
      labels.forEach((lb, i) => {
        doc.fillColor('white').fontSize(8).font('Helvetica-Bold')
          .text(lb, x + 2, y0 + 4, { width: cols[i] - 4, align: i < 2 ? 'left' : 'right' });
        x += cols[i];
      });
      doc.y = y0 + 18;

      itens.slice(0, 150).forEach((item, idx) => {
        const rowH = 16;
        checkSpace(rowH + 4);
        const ry = doc.y;
        const bg = idx % 2 === 0 ? GRAY : 'white';
        doc.rect(ML, ry, CW, rowH).fill(bg);
        x = ML;
        const vals = [
          item.numero ?? (idx + 1),
          item.descricao ?? '',
          item.unidade ?? '',
          item.quantidade ?? '',
          item.valor_unitario_estimado != null ? fmtBRL(item.valor_unitario_estimado) : '—',
          (item.valor_unitario_estimado != null && item.quantidade != null)
            ? fmtBRL(parseFloat(item.valor_unitario_estimado) * parseFloat(item.quantidade))
            : '—',
        ];
        vals.forEach((v, i) => {
          doc.fillColor(DARK).fontSize(7.5).font('Helvetica')
            .text(String(v), x + 2, ry + 3, {
              width: cols[i] - 4,
              align: i < 2 ? 'left' : 'right',
              lineBreak: false,
              ellipsis: true,
            });
          x += cols[i];
        });
        doc.y = ry + rowH;
      });

      if (itens.length > 150) {
        doc.moveDown(0.3);
        doc.fillColor(MID).fontSize(8).font('Helvetica-Oblique')
          .text(`… e mais ${itens.length - 150} itens (ver planilha XLSX para lista completa).`, ML);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 3: HABILITAÇÃO
    // ══════════════════════════════════════════════════════════════
    const habilitacao = Array.isArray(analise.habilitacao) ? analise.habilitacao : [];
    if (habilitacao.length > 0) {
      checkSpace(60);
      doc.moveDown(0.8);
      sectionTitle('3. Requisitos de Habilitação');

      habilitacao.forEach((grupo) => {
        checkSpace(40);
        doc.moveDown(0.4);
        doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold')
          .text(fmt(grupo.categoria), ML);
        doc.moveDown(0.2);
        const docs = Array.isArray(grupo.documentos) ? grupo.documentos : [];
        docs.forEach((d) => {
          checkSpace(14);
          const obrig = d.obrigatorio !== false;
          doc.fillColor(obrig ? NAVY : MID).fontSize(8.5).font('Helvetica')
            .text(`${obrig ? '■ Atenção' : '○'} ${fmt(d.nome)}`, ML + 10, doc.y);
          doc.moveDown(0.15);
        });
      });
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 4: RISCOS
    // ══════════════════════════════════════════════════════════════
    const riscos = Array.isArray(analise.riscos) ? analise.riscos : [];
    if (riscos.length > 0) {
      checkSpace(60);
      doc.moveDown(0.8);
      sectionTitle('4. Matriz de Riscos');
      doc.moveDown(0.3);

      // Table header
      const rCols = [130, 55, 285];
      const rLabels = ['Risco', 'Nível', 'Recomendação'];
      const ry0 = doc.y;
      doc.rect(ML, ry0, CW, 18).fill(NAVY);
      let rx = ML;
      rLabels.forEach((lb, i) => {
        doc.fillColor('white').fontSize(8).font('Helvetica-Bold')
          .text(lb, rx + 4, ry0 + 4, { width: rCols[i] - 8 });
        rx += rCols[i];
      });
      doc.y = ry0 + 18;

      riscos.forEach((r, idx) => {
        const needed = Math.max(
          doc.heightOfString(fmt(r.risco), { width: rCols[0] - 8, fontSize: 8 }),
          doc.heightOfString(fmt(r.recomendacao), { width: rCols[2] - 8, fontSize: 8 }),
        ) + 8;
        checkSpace(needed + 4);
        const rowY = doc.y;
        const bg = idx % 2 === 0 ? GRAY : 'white';
        doc.rect(ML, rowY, CW, needed).fill(bg);
        rx = ML;
        doc.fillColor(DARK).fontSize(8).font('Helvetica')
          .text(fmt(r.risco), rx + 4, rowY + 4, { width: rCols[0] - 8 });
        rx += rCols[0];
        const nc = nivelColor(r.nivel);
        doc.fillColor(nc).fontSize(8).font('Helvetica-Bold')
          .text(fmt(r.nivel), rx + 4, rowY + 4, { width: rCols[1] - 8, align: 'center' });
        rx += rCols[1];
        doc.fillColor(DARK).fontSize(8).font('Helvetica')
          .text(fmt(r.recomendacao), rx + 4, rowY + 4, { width: rCols[2] - 8 });
        doc.y = rowY + needed + 1;
      });
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 5: CHECKLIST
    // ══════════════════════════════════════════════════════════════
    const checklist = analise.checklist || {};
    const antes   = Array.isArray(checklist.antes)   ? checklist.antes   : [];
    const durante = Array.isArray(checklist.durante) ? checklist.durante : [];

    if (antes.length > 0 || durante.length > 0) {
      checkSpace(60);
      doc.moveDown(0.8);
      sectionTitle('5. Checklist de Participação');

      function renderChecklist(titulo, items) {
        if (items.length === 0) return;
        doc.moveDown(0.4);
        doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text(titulo, ML);
        doc.moveDown(0.2);
        items.forEach((item) => {
          checkSpace(14);
          doc.rect(ML + 10, doc.y + 2, 10, 10).strokeColor(TEAL).stroke();
          doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
            .text(fmt(item), ML + 26, doc.y, { width: CW - 26 });
          doc.moveDown(0.25);
        });
      }
      renderChecklist('Antes da sessão', antes);
      renderChecklist('Durante a sessão', durante);
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 6: ANÁLISE ESTRATÉGICA FINAL
    // ══════════════════════════════════════════════════════════════
    checkSpace(80);
    doc.moveDown(0.8);
    sectionTitle('6. Análise Estratégica Final');
    doc.moveDown(0.4);

    const scFinal = sc ?? 0;
    const decText = scFinal >= 60
      ? `Com score de ${scFinal}/100, este pregão é classificado como "${scoreLabel(scFinal)}" pelo Edson IA. A oportunidade apresenta bom potencial e recomendamos participação, observando os riscos e requisitos de habilitação identificados.`
      : scFinal >= 40
      ? `Com score de ${scFinal}/100, este pregão é classificado como "${scoreLabel(scFinal)}" pelo Edson IA. Avalie com cautela os riscos e requisitos antes de decidir pela participação.`
      : `Com score de ${scFinal}/100, este pregão é classificado como "${scoreLabel(scFinal)}" pelo Edson IA. Recomendamos análise detalhada dos requisitos e riscos antes de qualquer decisão.`;

    doc.fillColor(DARK).fontSize(9).font('Helvetica')
      .text(decText, ML, doc.y, { width: CW, align: 'justify' });

    doc.moveDown(1);
    doc.rect(ML, doc.y, CW, 1).fill(TEAL);
    doc.moveDown(0.5);
    doc.fillColor(MID).fontSize(8).font('Helvetica-Oblique')
      .text('Este relatório foi gerado automaticamente pelo Edson IA (ConlicitHub) com base nas informações disponíveis no PNCP e no cadastro do cliente. As análises são orientativas e não substituem a avaliação jurídica especializada.',
        ML, doc.y, { width: CW, align: 'justify' });

    // ── Page numbers ──────────────────────────────────────────────
    pageNum();

    doc.end();
  });
}

module.exports = { gerarRelatorioPDF };
