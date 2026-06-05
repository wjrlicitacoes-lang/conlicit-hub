// ─────────────────────────────────────────────────────────────────────────────
// Edson — Planilha de Preços
// Conlicit Hub | conlicit.com
//
// Fluxo:
//   1. extrairItensDoEdital  → lê texto do edital e retorna itens estruturados
//   2. pesquisarPrecosItem   → pesquisa 3 opções de mercado para 1 item
//   3. pesquisarPrecosLote   → orquestra pesquisa em lote (3 itens por vez)
//   4. gerarCSV              → monta CSV final com as opções escolhidas
// ─────────────────────────────────────────────────────────────────────────────

const axios = require('axios');
const db    = require('../database/db');

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-opus-4-5';
const CONCORRENCIA    = 3;   // itens processados em paralelo
const PAUSA_LOTE_MS   = 1200; // pausa entre lotes para respeitar rate limit

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiKey() {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error('ANTHROPIC_API_KEY não configurada no ambiente');
  return k;
}

function headers() {
  return {
    'x-api-key':         apiKey(),
    'anthropic-version': '2023-06-01',
    'content-type':      'application/json',
    'anthropic-beta':    'web-search-2025-03-05',
  };
}

function parsearJSON(texto) {
  const limpo = texto.replace(/```json|```/g, '').trim();
  try { return JSON.parse(limpo); } catch {
    const match = limpo.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Resposta do Edson não é um JSON válido');
  }
}

function pausa(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Prompt 1 — Extração de itens ─────────────────────────────────────────────

const PROMPT_EXTRACAO = `Você é o Edson, agente especializado em licitações públicas da Conlicit.

Extraia TODOS os itens/lotes do edital fornecido e retorne em JSON estruturado.

REGRAS:
- Capture todos os itens, mesmo com descrição incompleta
- Mantenha a descrição FIEL ao edital — não resuma, não altere
- Inclua especificações técnicas (normas, medidas, materiais) na descrição
- Se valor de referência não estiver no item, use null
- valor_total_estimado = quantidade × valor_referencia (ou null se não houver)

Retorne APENAS o JSON abaixo, sem texto adicional, sem markdown:

{
  "pregao": {
    "numero": "string",
    "orgao": "string",
    "objeto": "string",
    "abertura": "string ou null",
    "modalidade": "string"
  },
  "itens": [
    {
      "numero": 1,
      "descricao": "string — descrição completa conforme edital",
      "unidade": "string — un, kg, m, cx etc.",
      "quantidade": 10,
      "valor_referencia": 89.90,
      "valor_total_estimado": 899.00
    }
  ],
  "total_itens": 0
}`;

// ── Prompt 2 — Pesquisa de preços por item ────────────────────────────────────

const PROMPT_PESQUISA = `Você é o Edson, agente especializado em licitações públicas da Conlicit.

Pesquise no mercado brasileiro 3 opções de produto que atendam à descrição do item de licitação fornecido.

CRITÉRIOS:
- O produto DEVE atender às especificações técnicas do edital
- Prefira marcas conhecidas com boa disponibilidade nacional
- Use preços de atacado ou distribuidor — não varejo
- Ordene as opções do MENOR para o MAIOR preço
- Marque qual opção oferece melhor custo-benefício

TAGS DISPONÍVEIS (use apenas uma por opção, ou null):
- "menor_preco"          → opção mais barata
- "melhor_custo_beneficio" → melhor relação qualidade/preço
- "melhor_marca"         → marca mais reconhecida / maior facilidade de homologação

ATENÇÃO:
- Se o produto não atender 100% ao edital, indique "parcial" e descreva a diferença
- Se não encontrar 3 opções, retorne quantas encontrou e explique
- Preço deve ser competitivo para vencer o pregão (abaixo ou próximo ao valor de referência)

Retorne APENAS o JSON abaixo, sem texto adicional, sem markdown:

{
  "item_numero": 1,
  "descricao_edital": "string",
  "valor_referencia_edital": 89.90,
  "opcoes": [
    {
      "ordem": 1,
      "marca": "string",
      "modelo": "string",
      "descricao_produto": "string — o que é o produto encontrado",
      "preco_unitario": 74.90,
      "fonte_preco": "string — ex: Mercado Livre, site do fabricante, atacadista",
      "atende_especificacao": "completo",
      "observacoes": "string ou null",
      "tag": "menor_preco"
    }
  ],
  "recomendacao": "string — qual opção o Edson recomenda e por quê",
  "alerta": "string ou null — risco ou ponto de atenção sobre este item"
}`;

// ── Prompt 3 — Geração do CSV final ──────────────────────────────────────────

const PROMPT_CSV = `Você é o Edson, agente de licitações da Conlicit.

Gere uma planilha CSV com os itens e opções escolhidas, pronta para upload nas plataformas de pregão eletrônico.

FORMATO CSV:
- Separador: ponto e vírgula (;)
- Decimal: vírgula (89,90)
- Primeira linha: cabeçalho
- Uma linha por item
- Sem espaços extras, sem linhas em branco

COLUNAS (nesta ordem):
Item;Descrição;Marca;Modelo / Referência;Unidade;Quantidade;Preço Unitário (R$);Valor Total (R$)

REGRAS:
- Coluna "Descrição": use a descrição ORIGINAL do edital
- Coluna "Marca" e "Modelo / Referência": use o produto da opção escolhida
- Valor Total = Quantidade × Preço Unitário (calcule você)
- Preço unitário e Valor Total com vírgula decimal e duas casas (ex: 74,90)

Retorne APENAS o conteúdo CSV. Nenhum texto antes ou depois.`;

// ── Função 1: Extrair itens do edital ─────────────────────────────────────────

async function extrairItensDoEdital(textoEdital) {
  const { data } = await axios.post(ANTHROPIC_URL, {
    model:      ANTHROPIC_MODEL,
    max_tokens: 4000,
    messages: [{
      role:    'user',
      content: `${PROMPT_EXTRACAO}\n\n---\nTEXTO DO EDITAL:\n${textoEdital.slice(0, 80000)}`,
    }],
  }, { headers: headers(), timeout: 120000 });

  const texto = data.content.find(b => b.type === 'text')?.text || '';
  return parsearJSON(texto);
}

// ── Função 2: Pesquisar preços de 1 item (com web search) ────────────────────

async function pesquisarPrecosItem(item, segmentoCliente) {
  const contexto = `
ITEM DO EDITAL:
- Número: ${item.numero}
- Descrição: ${item.descricao}
- Unidade: ${item.unidade}
- Quantidade: ${item.quantidade}
- Valor de referência: ${item.valor_referencia ? `R$ ${item.valor_referencia}` : 'não informado'}
- Segmento do cliente: ${segmentoCliente || 'geral'}
  `.trim();

  const { data } = await axios.post(ANTHROPIC_URL, {
    model:      ANTHROPIC_MODEL,
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role:    'user',
      content: `${PROMPT_PESQUISA}\n\n${contexto}`,
    }],
  }, { headers: headers(), timeout: 120000 });

  const texto = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  return parsearJSON(texto);
}

// ── Função 3: Pesquisar preços em lote ───────────────────────────────────────

async function pesquisarPrecosLote(itensSelecionados, segmentoCliente) {
  const resultados = [];

  for (let i = 0; i < itensSelecionados.length; i += CONCORRENCIA) {
    const lote = itensSelecionados.slice(i, i + CONCORRENCIA);

    const promises = lote.map(item =>
      pesquisarPrecosItem(item, segmentoCliente).catch(err => ({
        item_numero: item.numero,
        descricao_edital: item.descricao,
        valor_referencia_edital: item.valor_referencia,
        opcoes: [],
        recomendacao: null,
        alerta: `Erro na pesquisa: ${err.message}`,
      }))
    );

    const loteResultados = await Promise.all(promises);
    resultados.push(...loteResultados);

    if (i + CONCORRENCIA < itensSelecionados.length) {
      await pausa(PAUSA_LOTE_MS);
    }
  }

  return resultados;
}

// ── Função 4: Gerar CSV final ─────────────────────────────────────────────────

async function gerarCSV(itensComOpcao) {
  const dadosFormatados = itensComOpcao
    .map(({ item, opcaoEscolhida }) => `
ITEM ${item.numero}:
- Descrição (edital): ${item.descricao}
- Unidade: ${item.unidade}
- Quantidade: ${item.quantidade}
- Marca escolhida: ${opcaoEscolhida.marca}
- Modelo/Referência: ${opcaoEscolhida.modelo}
- Preço unitário: R$ ${opcaoEscolhida.preco_unitario}
    `.trim())
    .join('\n\n');

  const { data } = await axios.post(ANTHROPIC_URL, {
    model:      ANTHROPIC_MODEL,
    max_tokens: 2000,
    messages: [{
      role:    'user',
      content: `${PROMPT_CSV}\n\nDADOS DOS ITENS:\n${dadosFormatados}`,
    }],
  }, { headers: headers(), timeout: 60000 });

  return data.content.find(b => b.type === 'text')?.text?.trim() || '';
}

// ── Persistência no banco ─────────────────────────────────────────────────────

async function salvarSelecao(analise_id, itensSelecionados) {
  await db.query(
    `UPDATE analises_edson
     SET itens_planilha_selecao = $1, atualizado_em = NOW()
     WHERE id = $2`,
    [JSON.stringify(itensSelecionados), analise_id],
  );
}

async function salvarPesquisa(analise_id, resultadosPesquisa) {
  await db.query(
    `UPDATE analises_edson
     SET itens_planilha_pesquisa = $1, atualizado_em = NOW()
     WHERE id = $2`,
    [JSON.stringify(resultadosPesquisa), analise_id],
  );
}

async function carregarDadosPlanilha(analise_id) {
  const { rows: [row] } = await db.query(
    `SELECT itens_planilha_selecao, itens_planilha_pesquisa
     FROM analises_edson WHERE id = $1`,
    [analise_id],
  );
  return row || {};
}

module.exports = {
  extrairItensDoEdital,
  pesquisarPrecosItem,
  pesquisarPrecosLote,
  gerarCSV,
  salvarSelecao,
  salvarPesquisa,
  carregarDadosPlanilha,
};
