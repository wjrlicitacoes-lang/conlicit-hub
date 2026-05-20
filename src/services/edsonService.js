const axios = require('axios');
const db = require('../database/db');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const PNCP_BASE = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/pncp/v1';

async function buscarItensPNCP(cnpj, ano, seq) {
  try {
    const { data } = await axios.get(
      `${PNCP_BASE}/orgaos/${cnpj}/compras/${ano}/${seq}/itens`,
      { params: { pagina: 1, tamanhoPagina: 500 }, timeout: 15000 },
    );
    return data.data ?? [];
  } catch {
    return [];
  }
}

function buildPrompt(pregao, itensPNCP) {
  const itensStr = itensPNCP.length > 0
    ? JSON.stringify(itensPNCP.slice(0, 50).map(i => ({
        numero: i.numeroItem,
        descricao: i.descricao,
        unidade: i.unidadeMedida,
        quantidade: i.quantidade,
        valorUnitarioEstimado: i.valorUnitarioEstimado,
      })), null, 2)
    : 'Não disponível via PNCP — inferir a partir do objeto do pregão.';

  const palavrasChave = Array.isArray(pregao.palavras_chave)
    ? pregao.palavras_chave.join(', ')
    : pregao.palavras_chave || '—';

  return `Você é o Edson, assistente especialista em licitações públicas brasileiras do ConlicitHub.

Analise o pregão abaixo e responda APENAS com um JSON válido (sem markdown, sem texto extra) com exatamente esta estrutura:

{
  "score": <inteiro 0-100>,
  "score_justificativa": "<2-3 frases explicando o score>",
  "resumo_executivo": "<3-4 frases de análise executiva>",
  "modalidade": "<ex: Pregão Eletrônico>",
  "modo_disputa": "<ex: Aberto>",
  "tipo_julgamento": "<ex: Menor Preço>",
  "itens": [
    { "numero": <int>, "descricao": "<str>", "unidade": "<str>", "quantidade": <number>, "valor_unitario_estimado": <number> }
  ],
  "habilitacao": [
    {
      "categoria": "<Jurídica|Fiscal|Técnica|Econômico-financeira>",
      "documentos": [{ "nome": "<str>", "obrigatorio": <bool> }]
    }
  ],
  "riscos": [
    { "risco": "<str>", "nivel": "<Alto|Médio|Baixo>", "recomendacao": "<str>" }
  ],
  "checklist": {
    "antes": ["<str>", ...],
    "durante": ["<str>", ...]
  }
}

DADOS DO PREGÃO:
- Número: ${pregao.numero || '—'}
- Órgão: ${pregao.orgao || '—'}
- Objeto: ${pregao.objeto || '—'}
- Valor estimado: ${pregao.valor_estimado ? `R$ ${pregao.valor_estimado}` : '—'}
- Data de abertura: ${pregao.data_hora_abertura || pregao.data_abertura || '—'}
${pregao.numero_controle_pncp ? `- Nº Controle PNCP: ${pregao.numero_controle_pncp}` : ''}

PERFIL DO CLIENTE:
- Nome: ${pregao.nome || '—'}
- UF: ${pregao.uf || '—'}
- Palavras-chave de interesse: ${palavrasChave}

ITENS DO EDITAL (via PNCP):
${itensStr}

Critérios de score:
80-100 = Excelente (poucas exigências, objeto alinhado, valor viável)
60-79  = Bom (algumas exigências, boa oportunidade)
40-59  = Regular (riscos moderados, analisar com cuidado)
20-39  = Difícil (muitas exigências ou riscos relevantes)
0-19   = Não recomendado (inviável ou muito restritivo)

Para habilitação, infira os requisitos típicos com base no objeto e valor.
Para o checklist, use as melhores práticas de pregão eletrônico no Brasil.
Responda APENAS com o JSON, nenhum texto adicional.`;
}

async function analisarPregao(analiseId, pregaoId) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

    const { rows: [pregao] } = await db.query(
      `SELECT p.*, c.nome, c.uf, c.palavras_chave
       FROM pregoes p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.id = $1`,
      [pregaoId],
    );
    if (!pregao) throw new Error('Pregão não encontrado');

    let itensPNCP = [];

    if (pregao.numero_controle_pncp) {
      // Formato: {CNPJ}-1-{SEQ:06}/{ANO}
      const m = pregao.numero_controle_pncp.match(/^(\d+)-\d+-0*(\d+)\/(\d{4})$/);
      if (m) itensPNCP = await buscarItensPNCP(m[1], m[3], m[2]);
    }

    const { data } = await axios.post(
      ANTHROPIC_URL,
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: buildPrompt(pregao, itensPNCP) }],
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 120000,
      },
    );

    const raw = data.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Resposta da IA não é JSON válido');
    }

    // Merge PNCP items if Claude returned none but we have them
    if ((!parsed.itens || parsed.itens.length === 0) && itensPNCP.length > 0) {
      parsed.itens = itensPNCP.slice(0, 100).map(i => ({
        numero: i.numeroItem,
        descricao: i.descricao,
        unidade: i.unidadeMedida,
        quantidade: i.quantidade,
        valor_unitario_estimado: i.valorUnitarioEstimado,
      }));
    }

    await db.query(
      `UPDATE analises_edson SET
         status = 'pronto',
         score = $2, score_justificativa = $3, resumo_executivo = $4,
         modalidade = $5, modo_disputa = $6, tipo_julgamento = $7,
         itens = $8, habilitacao = $9, riscos = $10, checklist = $11,
         atualizado_em = NOW()
       WHERE id = $1`,
      [
        analiseId,
        parsed.score ?? null,
        parsed.score_justificativa ?? null,
        parsed.resumo_executivo ?? null,
        parsed.modalidade ?? null,
        parsed.modo_disputa ?? null,
        parsed.tipo_julgamento ?? null,
        JSON.stringify(parsed.itens ?? []),
        JSON.stringify(parsed.habilitacao ?? []),
        JSON.stringify(parsed.riscos ?? []),
        JSON.stringify(parsed.checklist ?? { antes: [], durante: [] }),
      ],
    );
  } catch (e) {
    console.error('[Edson] Erro na análise:', e.message);
    await db.query(
      `UPDATE analises_edson SET status = 'erro', erro_mensagem = $2, atualizado_em = NOW() WHERE id = $1`,
      [analiseId, e.message],
    );
  }
}

async function chamarClaude(systemPrompt, messages) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const { data } = await axios.post(
    ANTHROPIC_URL,
    { model: 'claude-sonnet-4-6', max_tokens: 1024, system: systemPrompt, messages },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 60000,
    },
  );
  return data.content[0].text;
}

module.exports = { analisarPregao, chamarClaude };
