const ExcelJS = require('exceljs');

async function gerarPlanilhaXLSX({ analise, pregao }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ConlicitHub — Edson IA';
  wb.created = new Date();

  const ws = wb.addWorksheet('Proposta de Preços');

  // Column widths
  ws.columns = [
    { key: 'A', width: 8  },
    { key: 'B', width: 60 },
    { key: 'C', width: 12 },
    { key: 'D', width: 8  },
    { key: 'E', width: 18 },
    { key: 'F', width: 20 },
    { key: 'G', width: 18 },
    { key: 'H', width: 18 },
  ];

  const NAVY   = 'FF182A39';
  const TEAL   = 'FF4CC5D7';
  const GRAY   = 'FFD9D9D9';
  const YELLOW = 'FFFFFACD';
  const WHITE  = 'FFFFFFFF';

  function merge(r1, c1, r2, c2) {
    ws.mergeCells(r1, c1, r2, c2);
  }
  function cell(row, col) {
    return ws.getCell(row, col);
  }
  function setVal(row, col, val) {
    cell(row, col).value = val;
  }
  function bold(row, col) {
    cell(row, col).font = { bold: true };
  }

  // ── Row 1: title ──────────────────────────────────────────────
  merge(1, 1, 1, 8);
  setVal(1, 1, 'PLANILHA DE PROPOSTA DE PREÇOS');
  const r1 = ws.getRow(1);
  r1.height = 22;
  const titleCell = cell(1, 1);
  titleCell.font      = { bold: true, size: 13, color: { argb: WHITE } };
  titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // ── Row 2: process info ───────────────────────────────────────
  merge(2, 1, 2, 2);
  setVal(2, 1, `Pregão: ${pregao.numero || '—'}`);
  bold(2, 1);
  merge(2, 3, 2, 5);
  setVal(2, 3, `Sessão: ${pregao.data_hora_abertura ? new Date(pregao.data_hora_abertura).toLocaleString('pt-BR') : (pregao.data_abertura || '—')}`);
  merge(2, 6, 2, 8);
  setVal(2, 6, `Tipo de Julgamento: ${analise.tipo_julgamento || 'Menor Preço'}`);
  ws.getRow(2).height = 16;
  for (let c = 1; c <= 8; c++) {
    cell(2, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
  }

  // ── Row 3: company info (blank for user to fill) ──────────────
  merge(3, 1, 3, 4);
  setVal(3, 1, 'Empresa: _______________________________________________');
  merge(3, 5, 3, 8);
  setVal(3, 5, 'CNPJ: ____________________________________');
  ws.getRow(3).height = 15;

  // ── Row 4: bank info ──────────────────────────────────────────
  merge(4, 1, 4, 4);
  setVal(4, 1, 'Banco: ____________  Agência: __________  Conta: _________________');
  merge(4, 5, 4, 8);
  setVal(4, 5, 'Validade da Proposta: 90 (noventa) dias');
  ws.getRow(4).height = 15;

  // ── Row 5: instructions ───────────────────────────────────────
  merge(5, 1, 5, 8);
  setVal(5, 1, 'Preencha as colunas em amarelo (Meu Preço Unitário). O total por item e o total geral são calculados automaticamente.');
  const instrCell = cell(5, 1);
  instrCell.font      = { italic: true, size: 9, color: { argb: 'FF555555' } };
  instrCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  ws.getRow(5).height = 14;

  // ── Row 6: header ─────────────────────────────────────────────
  const headers = ['Nº Item', 'Descrição', 'Unidade', 'Qtd', 'Vr Unit. Estimado', 'Meu Vr Unitário', 'Meu Vr Total', 'Vr Total Geral'];
  headers.forEach((h, i) => {
    const c = cell(6, i + 1);
    c.value     = h;
    c.font      = { bold: true, color: { argb: WHITE } };
    c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border    = {
      bottom: { style: 'thin', color: { argb: NAVY } },
      right:  { style: 'thin', color: { argb: NAVY } },
    };
  });
  ws.getRow(6).height = 28;

  // ── Rows 7+: items ────────────────────────────────────────────
  const itens = Array.isArray(analise.itens) ? analise.itens : [];
  const dataStart = 7;

  const borderThin = {
    top:    { style: 'thin', color: { argb: 'FFCCCCCC' } },
    left:   { style: 'thin', color: { argb: 'FFCCCCCC' } },
    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    right:  { style: 'thin', color: { argb: 'FFCCCCCC' } },
  };

  itens.forEach((item, idx) => {
    const rowNum = dataStart + idx;
    const row = ws.getRow(rowNum);
    row.height = 18;

    const rowFill = idx % 2 === 0
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: WHITE } }
      : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };

    // Col A: numero
    const cA = cell(rowNum, 1);
    cA.value     = item.numero ?? (idx + 1);
    cA.alignment = { horizontal: 'center', vertical: 'middle' };
    cA.fill      = rowFill;
    cA.border    = borderThin;

    // Col B: descricao
    const cB = cell(rowNum, 2);
    cB.value     = item.descricao ?? '';
    cB.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    cB.fill      = rowFill;
    cB.border    = borderThin;

    // Col C: unidade
    const cC = cell(rowNum, 3);
    cC.value     = item.unidade ?? '';
    cC.alignment = { horizontal: 'center', vertical: 'middle' };
    cC.fill      = rowFill;
    cC.border    = borderThin;

    // Col D: quantidade
    const cD = cell(rowNum, 4);
    cD.value     = item.quantidade ?? '';
    cD.numFmt    = '#,##0.##';
    cD.alignment = { horizontal: 'right', vertical: 'middle' };
    cD.fill      = rowFill;
    cD.border    = borderThin;

    // Col E: valor_unitario_estimado
    const cE = cell(rowNum, 5);
    cE.value     = item.valor_unitario_estimado ?? '';
    cE.numFmt    = 'R$ #,##0.00';
    cE.alignment = { horizontal: 'right', vertical: 'middle' };
    cE.fill      = rowFill;
    cE.border    = borderThin;

    // Col F: meu preço unitário (yellow — user fills)
    const cF = cell(rowNum, 6);
    cF.value     = null;
    cF.numFmt    = 'R$ #,##0.00';
    cF.alignment = { horizontal: 'right', vertical: 'middle' };
    cF.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    cF.border    = borderThin;

    // Col G: meu preço total = F * D (yellow)
    const cG = cell(rowNum, 7);
    cG.value     = { formula: `IF(F${rowNum}="","",F${rowNum}*D${rowNum})` };
    cG.numFmt    = 'R$ #,##0.00';
    cG.alignment = { horizontal: 'right', vertical: 'middle' };
    cG.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    cG.border    = borderThin;

    // Col H: valor total geral (estimado * qtd)
    const cH = cell(rowNum, 8);
    cH.value     = { formula: `IF(E${rowNum}="","",E${rowNum}*D${rowNum})` };
    cH.numFmt    = 'R$ #,##0.00';
    cH.alignment = { horizontal: 'right', vertical: 'middle' };
    cH.fill      = rowFill;
    cH.border    = borderThin;
  });

  // ── Total row ─────────────────────────────────────────────────
  const lastItem = dataStart + itens.length - 1;
  const totalRow = dataStart + itens.length;
  const tr = ws.getRow(totalRow);
  tr.height = 20;

  merge(totalRow, 1, totalRow, 5);
  const cTotLabel = cell(totalRow, 1);
  cTotLabel.value     = 'TOTAL GERAL';
  cTotLabel.font      = { bold: true };
  cTotLabel.alignment = { horizontal: 'right', vertical: 'middle' };
  cTotLabel.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };

  const cTotF = cell(totalRow, 6);
  cTotF.value  = '';
  cTotF.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };

  const cTotG = cell(totalRow, 7);
  cTotG.value  = itens.length > 0 ? { formula: `IFERROR(SUM(G${dataStart}:G${lastItem}),0)` } : 0;
  cTotG.numFmt = 'R$ #,##0.00';
  cTotG.font   = { bold: true };
  cTotG.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
  cTotG.border = borderThin;

  const cTotH = cell(totalRow, 8);
  cTotH.value  = itens.length > 0 ? { formula: `IFERROR(SUM(H${dataStart}:H${lastItem}),0)` } : 0;
  cTotH.numFmt = 'R$ #,##0.00';
  cTotH.font   = { bold: true };
  cTotH.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
  cTotH.border = borderThin;

  // ── Footer rows ───────────────────────────────────────────────
  const f1 = totalRow + 2;
  merge(f1, 1, f1, 8);
  setVal(f1, 1, '* Validade da proposta: 90 (noventa) dias corridos a partir da data de abertura da sessão.');
  cell(f1, 1).font = { italic: true, size: 9 };

  const f2 = f1 + 1;
  merge(f2, 1, f2, 8);
  setVal(f2, 1, '* Prazo de entrega/execução conforme edital. Forma de fornecimento: conforme especificações do termo de referência.');
  cell(f2, 1).font = { italic: true, size: 9 };

  const f3 = f2 + 2;
  merge(f3, 1, f3, 4);
  setVal(f3, 1, 'Declaro que os preços acima são reais e que cumpriremos todas as exigências do edital.');
  cell(f3, 1).font = { size: 9 };

  const f4 = f3 + 3;
  merge(f4, 1, f4, 3);
  ws.getRow(f4).getCell(1).border = { bottom: { style: 'thin' } };
  setVal(f4, 1, 'Assinatura e carimbo do responsável');
  cell(f4, 1).alignment = { horizontal: 'center' };
  cell(f4, 1).font      = { size: 9 };

  merge(f4, 5, f4, 8);
  ws.getRow(f4).getCell(5).border = { bottom: { style: 'thin' } };
  setVal(f4, 5, 'Local e data');
  cell(f4, 5).alignment = { horizontal: 'center' };
  cell(f4, 5).font      = { size: 9 };

  // ── Freeze top rows, print settings ───────────────────────────
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 6 }];
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  };

  return wb.xlsx.writeBuffer();
}

module.exports = { gerarPlanilhaXLSX };
