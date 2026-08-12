const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, AlignmentType, WidthType, BorderStyle, ShadingType, HeadingLevel,
} = require('docx');
const { Jimp, JimpMime } = require('jimp');
const { createClient } = require('@supabase/supabase-js');
const db = require('../database/db');

// Mesma paleta usada nos relatórios do Edson (src/services/relatorioService.js),
// mantida para consistência visual entre os documentos gerados pelo Hub.
const TEAL = '4CC5D7';
const NAVY = '182A39';
const GRAY_BORDER = 'CCCCCC';

function supabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function processarLogo(logoBase64) {
  if (!logoBase64) return null;
  try {
    const base64Data = logoBase64.split(',').pop();
    const buffer = Buffer.from(base64Data, 'base64');
    const img = await Jimp.read(buffer);
    const larguraMax = 180;
    if (img.bitmap.width > larguraMax) img.resize({ w: larguraMax });
    const pngBuffer = await img.getBuffer(JimpMime.png);
    return { buffer: pngBuffer, width: img.bitmap.width, height: img.bitmap.height };
  } catch (e) {
    console.error('[GeradorProposta] falha ao processar logo:', e.message);
    return null;
  }
}

function moeda(valor) {
  return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Combina, nesta ordem de prioridade: itens explicitamente enviados no request (edição
// manual do usuário) > itens_planilha_selecao (marca/preço pesquisados pelo Edson) >
// itens brutos extraídos do edital (analises_edson.itens, sem marca/preço definido).
function montarItens({ itensRequest, itensPlanilhaSelecao, itensEdital }) {
  if (Array.isArray(itensRequest) && itensRequest.length) return itensRequest;

  if (Array.isArray(itensPlanilhaSelecao) && itensPlanilhaSelecao.length) {
    return itensPlanilhaSelecao.map(({ item, opcaoEscolhida }) => ({
      numero: item?.numero,
      descricao: item?.descricao,
      unidade: item?.unidade,
      quantidade: item?.quantidade,
      marca: opcaoEscolhida?.marca || '',
      valor_unitario: opcaoEscolhida?.preco_unitario ?? 0,
    }));
  }

  return (itensEdital || []).map(i => ({
    numero: i.numero,
    descricao: i.descricao,
    unidade: i.unidade,
    quantidade: i.quantidade,
    marca: '',
    valor_unitario: i.valor_unitario_estimado ?? 0,
  }));
}

function celula(texto, { header = false, align = AlignmentType.LEFT, width } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { fill: TEAL, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text: String(texto ?? ''), bold: header, color: header ? 'FFFFFF' : undefined, size: 20 })],
    })],
  });
}

function tabelaItens(itens) {
  const cabecalho = new TableRow({
    tableHeader: true,
    children: [
      celula('Item', { header: true, width: 6 }),
      celula('Descrição', { header: true, width: 34 }),
      celula('Un.', { header: true, width: 6, align: AlignmentType.CENTER }),
      celula('Qtd.', { header: true, width: 8, align: AlignmentType.CENTER }),
      celula('Marca', { header: true, width: 14 }),
      celula('V. Unit.', { header: true, width: 12, align: AlignmentType.RIGHT }),
      celula('V. Total', { header: true, width: 12, align: AlignmentType.RIGHT }),
    ],
  });

  const linhas = itens.map(i => new TableRow({
    children: [
      celula(i.numero, { align: AlignmentType.CENTER }),
      celula(i.descricao),
      celula(i.unidade, { align: AlignmentType.CENTER }),
      celula(i.quantidade, { align: AlignmentType.CENTER }),
      celula(i.marca || '—'),
      celula(moeda(i.valor_unitario), { align: AlignmentType.RIGHT }),
      celula(moeda((Number(i.valor_unitario) || 0) * (Number(i.quantidade) || 0)), { align: AlignmentType.RIGHT }),
    ],
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: GRAY_BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: GRAY_BORDER },
      left: { style: BorderStyle.SINGLE, size: 2, color: GRAY_BORDER },
      right: { style: BorderStyle.SINGLE, size: 2, color: GRAY_BORDER },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: GRAY_BORDER },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: GRAY_BORDER },
    },
    rows: [cabecalho, ...linhas],
  });
}

const DECLARACOES = [
  'A proposta tem validade de 60 (sessenta) dias corridos, contados da data de abertura da sessão pública.',
  'Os preços apresentados incluem todos os custos diretos e indiretos, tributos, encargos e demais despesas necessárias ao cumprimento integral do objeto.',
  'A empresa declara, para os devidos fins, que cumpre plenamente os requisitos de habilitação exigidos no edital.',
  'A empresa declara ter tratado os dados pessoais eventualmente utilizados nesta proposta em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018).',
  'A empresa declara elaborar esta proposta de forma independente, sem qualquer conluio com demais licitantes.',
];

async function gerarProposta({ pregaoId, itensRequest, usuarioId }) {
  const { rows: [pregao] } = await db.query(
    `SELECT p.*, c.id AS cliente_id, c.nome AS cliente_nome, c.cnpj, c.razao_social,
            c.endereco, c.whatsapp, c.contato_whatsapp, c.email, c.logo_base64
       FROM pregoes p JOIN clientes c ON c.id = p.cliente_id
      WHERE p.id = $1`,
    [pregaoId],
  );
  if (!pregao) throw new Error('Pregão não encontrado');

  const { rows: [analise] } = await db.query(
    `SELECT itens, itens_planilha_selecao FROM analises_edson WHERE pregao_id = $1`,
    [pregaoId],
  );

  const itens = montarItens({
    itensRequest,
    itensPlanilhaSelecao: analise?.itens_planilha_selecao,
    itensEdital: analise?.itens,
  });
  const valorTotal = itens.reduce((soma, i) => soma + (Number(i.valor_unitario) || 0) * (Number(i.quantidade) || 0), 0);

  const logo = await processarLogo(pregao.logo_base64);

  const cabecalhoChildren = [];
  if (logo) {
    cabecalhoChildren.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new ImageRun({ type: 'png', data: logo.buffer, transformation: { width: logo.width, height: logo.height } })],
    }));
  }
  cabecalhoChildren.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'PROPOSTA COMERCIAL', color: NAVY, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `Pregão nº ${pregao.numero || '—'}`, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `Órgão: ${pregao.orgao || '—'}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Objeto: ${pregao.objeto || '—'}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Proponente: ${pregao.razao_social || pregao.cliente_nome}${pregao.cnpj ? ` — CNPJ ${pregao.cnpj}` : ''}` })] }),
    new Paragraph({ text: '' }),
  );

  const resumoChildren = [
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Resumo', color: NAVY, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `Valor total da proposta: ${moeda(valorTotal)}`, bold: true, size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: 'Validade da proposta: 60 dias corridos.' })] }),
    new Paragraph({ text: '' }),
  ];

  const declaracoesChildren = [
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Declarações', color: NAVY, bold: true })] }),
    ...DECLARACOES.map(d => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: d })] })),
    new Paragraph({ text: '' }),
  ];

  const rodapeChildren = [
    new Paragraph({ text: '' }),
    new Paragraph({ children: [new TextRun({ text: '_______________________________________________' })] }),
    new Paragraph({ children: [new TextRun({ text: pregao.razao_social || pregao.cliente_nome, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: [pregao.contato_whatsapp || pregao.whatsapp, pregao.email].filter(Boolean).join(' · ') })] }),
    new Paragraph({ children: [new TextRun({ text: pregao.endereco || '' })] }),
  ];

  const doc = new Document({
    sections: [{
      children: [
        ...cabecalhoChildren,
        tabelaItens(itens),
        new Paragraph({ text: '' }),
        ...resumoChildren,
        ...declaracoesChildren,
        ...rodapeChildren,
      ],
    }],
  });

  const bufferDocx = await Packer.toBuffer(doc);

  const sb = supabase();
  if (!sb) throw new Error('Supabase não configurado');

  const fileName = `${pregaoId}/proposta/${Date.now()}_proposta.docx`;
  const { error: upErr } = await sb.storage.from('pregoes-docs').upload(fileName, bufferDocx, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: true,
  });
  if (upErr) throw upErr;
  const { data: { publicUrl } } = sb.storage.from('pregoes-docs').getPublicUrl(fileName);

  const { rows: [versaoAnterior] } = await db.query(
    `SELECT COALESCE(MAX(versao), 0) AS max_versao FROM pregao_propostas WHERE pregao_id = $1`,
    [pregaoId],
  );
  const versao = Number(versaoAnterior.max_versao) + 1;

  const { rows: [proposta] } = await db.query(
    `INSERT INTO pregao_propostas (pregao_id, versao, arquivo_url, valor_total, itens_precificados, gerado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [pregaoId, versao, publicUrl, valorTotal, JSON.stringify(itens), usuarioId || null],
  );

  await db.query(
    `INSERT INTO pregao_documentos (pregao_id, tipo, nome_arquivo, url_arquivo, criado_por)
     VALUES ($1,'proposta',$2,$3,$4)`,
    [pregaoId, `proposta_v${versao}.docx`, publicUrl, usuarioId || null],
  );

  return proposta;
}

module.exports = { gerarProposta };
