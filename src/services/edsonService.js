const axios    = require('axios');
const pdfParse = require('pdf-parse');
const db = require('../database/db');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const PNCP_BASE = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/pncp/v1';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsearControle(numeroControle) {
  const partes = numeroControle.split('-');
  const cnpj = partes[0];
  const resto = partes[partes.length - 1];
  const [seq, ano] = resto.split('/');
  return { cnpj, ano, seq: parseInt(seq, 10).toString() };
}

async function buscarItensPNCP(cnpj, ano, seq) {
  try {
    const { data } = await axios.get(
      `${PNCP_BASE}/orgaos/${cnpj}/compras/${ano}/${seq}/itens`,
      { timeout: 10000 },
    );
    return Array.isArray(data) ? data : (data.data ?? []);
  } catch {
    return [];
  }
}

function calcularScore(criterios) {
  const {
    alinhamento_objeto = 0, complexidade_habilitacao = 0,
    valor_viabilidade = 0, modo_disputa = 0,
    risco_juridico = 0, prazo_adequado = 0,
  } = criterios || {};
  return Math.min(100, Math.max(0,
    Number(alinhamento_objeto) + Number(complexidade_habilitacao) +
    Number(valor_viabilidade) + Number(modo_disputa) +
    Number(risco_juridico) + Number(prazo_adequado),
  ));
}

function formatarDataHora(dt) {
  if (!dt) return '—';
  try {
    const d = new Date(dt);
    if (isNaN(d.getTime())) return String(dt);
    const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${data} às ${hora}`;
  } catch {
    return String(dt);
  }
}

async function buscarDataSessao(pregao) {
  if (pregao.numero_controle_pncp) {
    try {
      const { rows } = await db.query(
        `SELECT raw->>'dataAberturaProposta' AS dt_abertura,
                raw->>'dataEncerramentoProposta' AS dt_encerramento,
                data_encerramento
         FROM editais_cache WHERE numero_controle_pncp = $1 LIMIT 1`,
        [pregao.numero_controle_pncp],
      );
      if (rows.length) {
        const dt = rows[0].dt_abertura || rows[0].dt_encerramento || rows[0].data_encerramento;
        if (dt) return formatarDataHora(dt);
      }
    } catch { /* segue */ }
  }
  const dt = pregao.data_hora_abertura || pregao.data_encerramento || pregao.data_abertura || pregao.data_publicacao;
  return formatarDataHora(dt);
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const RUBRICA_INSTRUCAO = `
RUBRICA DE SCORE — preencha cada critério com o valor indicado:
{
  "criterios_score": {
    "alinhamento_objeto": <0-25>,       // 25=objeto exato do cliente, 0=sem relação
    "complexidade_habilitacao": <0-20>, // 20=só declarações, 0=atestado técnico complexo
    "valor_viabilidade": <0-20>,        // 20=valor alto e rentável, 0=valor baixo/sigiloso
    "modo_disputa": <0-15>,             // 15=aberto por item, 0=fechado global
    "risco_juridico": <0-10>,           // 10=sem riscos, 0=muitos riscos graves
    "prazo_adequado": <0-10>            // 10=prazo confortável, 0=prazo já passou/<24h
  }
}
NÃO inclua campo "score" — o sistema calcula a soma automaticamente.`;

function buildPrompt(pregao, itensPNCP, dataSessao) {
  const itensStr = itensPNCP.length > 0
    ? JSON.stringify(itensPNCP.slice(0, 50).map(i => ({
        numero: i.numeroItem, descricao: i.descricao,
        unidade: i.unidadeMedida, quantidade: i.quantidade,
        valorUnitarioEstimado: i.valorUnitarioEstimado,
      })), null, 2)
    : 'Não disponível via PNCP — inferir a partir do objeto do pregão.';

  const palavrasChave = Array.isArray(pregao.palavras_chave)
    ? pregao.palavras_chave.join(', ')
    : pregao.palavras_chave || '—';

  return `Você é o Edson, assistente especialista em licitações públicas brasileiras do ConlicitHub.

REGRA ABSOLUTA: Nunca invente, assuma ou deduza informações não explicitamente presentes no documento. Se uma informação não estiver no edital, responda exatamente "Não informado no edital". Toda afirmação deve ter referência direta no documento analisado.

Analise o pregão abaixo e responda APENAS com um JSON válido (sem markdown, sem texto extra) com exatamente esta estrutura:

{
  "criterios_score": {
    "alinhamento_objeto": <0-25>,
    "complexidade_habilitacao": <0-20>,
    "valor_viabilidade": <0-20>,
    "modo_disputa": <0-15>,
    "risco_juridico": <0-10>,
    "prazo_adequado": <0-10>
  },
  "score_justificativa": "<2-3 frases explicando os pontos fortes e fracos>",
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
  },
  "tipo_fornecimento": "<produto|servico>",
  "entrega_tipo": "<integral|parcelada|null>",
  "julgamento_tipo": "<por_item|por_lote|global>",
  "locais_entrega": "<string com locais ou null>",
  "prazo_entrega": "<string com prazo ou null>",
  "habilitacao_juridica": ["<doc 1>", "<doc 2>"],
  "habilitacao_economica": { "exige_balanco": <bool>, "capital_minimo": "<valor ou null>", "detalhes": "<string>" },
  "capacidade_tecnica": { "exige_atestado": <bool>, "descricao": "<string>" }
}

${RUBRICA_INSTRUCAO}

DADOS DO PREGÃO:
- Número: ${pregao.numero || '—'}
- Órgão: ${pregao.orgao || '—'}
- Objeto: ${pregao.objeto || '—'}
- Valor estimado: ${pregao.valor_estimado ? `R$ ${pregao.valor_estimado}` : '—'}
⚠️ DATA DA SESSÃO: ${dataSessao} — use esta data em toda análise
${pregao.numero_controle_pncp ? `- Nº Controle PNCP: ${pregao.numero_controle_pncp}` : ''}

PERFIL DO CLIENTE:
- Nome: ${pregao.nome || '—'}
- UF: ${pregao.uf || '—'}
- Palavras-chave de interesse: ${palavrasChave}

ITENS DO EDITAL (via PNCP):
${itensStr}

Para habilitação, infira os requisitos típicos com base no objeto e valor.
Para o checklist, use as melhores práticas de pregão eletrônico no Brasil.
Responda APENAS com o JSON, nenhum texto adicional.`;
}

function buildPromptPDF(pregao, pdfText, dataSessao) {
  const palavrasChave = Array.isArray(pregao.palavras_chave)
    ? pregao.palavras_chave.join(', ')
    : pregao.palavras_chave || '—';

  return `Você é o Edson, assistente especialista em licitações públicas brasileiras do ConlicitHub.

Analise o edital abaixo (extraído de PDF) e responda APENAS com um JSON válido (sem markdown, sem texto extra) com exatamente esta estrutura:

{
  "criterios_score": {
    "alinhamento_objeto": <0-25>,
    "complexidade_habilitacao": <0-20>,
    "valor_viabilidade": <0-20>,
    "modo_disputa": <0-15>,
    "risco_juridico": <0-10>,
    "prazo_adequado": <0-10>
  },
  "score_justificativa": "<2-3 frases>",
  "resumo_executivo": "<3-4 frases>",
  "modalidade": "<str>",
  "modo_disputa": "<str>",
  "tipo_julgamento": "<str>",
  "itens": [ { "numero": <int>, "descricao": "<str>", "unidade": "<str>", "quantidade": <number>, "valor_unitario_estimado": <number> } ],
  "habilitacao": [ { "categoria": "<str>", "documentos": [ { "nome": "<str>", "obrigatorio": <bool> } ] } ],
  "riscos": [ { "risco": "<str>", "nivel": "<Alto|Médio|Baixo>", "recomendacao": "<str>" } ],
  "checklist": { "antes": ["<str>"], "durante": ["<str>"] },
  "tipo_fornecimento": "<produto|servico>",
  "entrega_tipo": "<integral|parcelada|null>",
  "julgamento_tipo": "<por_item|por_lote|global>",
  "locais_entrega": "<string com locais ou null>",
  "prazo_entrega": "<string com prazo ou null>",
  "habilitacao_juridica": ["<doc 1>", "<doc 2>"],
  "habilitacao_economica": { "exige_balanco": <bool>, "capital_minimo": "<valor ou null>", "detalhes": "<string>" },
  "capacidade_tecnica": { "exige_atestado": <bool>, "descricao": "<string>" }
}

${RUBRICA_INSTRUCAO}

DADOS DO PREGÃO:
- Número: ${pregao.numero || '—'}
- Órgão: ${pregao.orgao || '—'}
- Objeto: ${pregao.objeto || '—'}
- Valor estimado: ${pregao.valor_estimado ? `R$ ${pregao.valor_estimado}` : '—'}
⚠️ DATA DA SESSÃO: ${dataSessao} — use esta data em toda análise
${pregao.numero_controle_pncp ? `- Nº Controle PNCP: ${pregao.numero_controle_pncp}` : ''}

PERFIL DO CLIENTE:
- Nome: ${pregao.nome || '—'}
- UF: ${pregao.uf || '—'}
- Palavras-chave de interesse: ${palavrasChave}

TEXTO DO EDITAL (extraído do PDF):
${pdfText}

Responda APENAS com o JSON, nenhum texto adicional.`;
}

function buildPromptAvulso(opts, itensPNCP, pdfText) {
  const { referencia, numero_controle_pncp, clienteNome, clienteUF, palavrasChave } = opts;
  const itensStr = pdfText
    ? `TEXTO DO EDITAL (extraído do PDF):\n${pdfText}`
    : itensPNCP.length > 0
      ? `ITENS DO EDITAL (via PNCP):\n${JSON.stringify(itensPNCP.slice(0, 50).map(i => ({
          numero: i.numeroItem, descricao: i.descricao,
          unidade: i.unidadeMedida, quantidade: i.quantidade,
          valorUnitarioEstimado: i.valorUnitarioEstimado,
        })), null, 2)}`
      : 'ITENS DO EDITAL: Não disponível — infira com base no objeto.';

  return `Você é o Edson, assistente especialista em licitações públicas brasileiras do ConlicitHub.

Analise a licitação abaixo e responda APENAS com um JSON válido com exatamente esta estrutura:

{
  "criterios_score": {
    "alinhamento_objeto": <0-25>,
    "complexidade_habilitacao": <0-20>,
    "valor_viabilidade": <0-20>,
    "modo_disputa": <0-15>,
    "risco_juridico": <0-10>,
    "prazo_adequado": <0-10>
  },
  "score_justificativa": "<2-3 frases>",
  "resumo_executivo": "<3-4 frases>",
  "modalidade": "<str>", "modo_disputa": "<str>", "tipo_julgamento": "<str>",
  "itens": [ { "numero": <int>, "descricao": "<str>", "unidade": "<str>", "quantidade": <number>, "valor_unitario_estimado": <number> } ],
  "habilitacao": [ { "categoria": "<str>", "documentos": [ { "nome": "<str>", "obrigatorio": <bool> } ] } ],
  "riscos": [ { "risco": "<str>", "nivel": "<Alto|Médio|Baixo>", "recomendacao": "<str>" } ],
  "checklist": { "antes": ["<str>"], "durante": ["<str>"] },
  "tipo_fornecimento": "<produto|servico>",
  "entrega_tipo": "<integral|parcelada|null>",
  "julgamento_tipo": "<por_item|por_lote|global>",
  "locais_entrega": "<string com locais ou null>",
  "prazo_entrega": "<string com prazo ou null>",
  "habilitacao_juridica": ["<doc 1>", "<doc 2>"],
  "habilitacao_economica": { "exige_balanco": <bool>, "capital_minimo": "<valor ou null>", "detalhes": "<string>" },
  "capacidade_tecnica": { "exige_atestado": <bool>, "descricao": "<string>" }
}

${RUBRICA_INSTRUCAO}

REFERÊNCIA: ${referencia || '—'}
${numero_controle_pncp ? `Nº Controle PNCP: ${numero_controle_pncp}` : ''}
${clienteNome ? `CLIENTE: ${clienteNome} (${clienteUF || '—'}) — Palavras-chave: ${palavrasChave || '—'}` : ''}

${itensStr}

Responda APENAS com o JSON, nenhum texto adicional.`;
}

// ── Chamada Claude + parse ────────────────────────────────────────────────────

async function callClaude(prompt, maxTokens = 4096, extraContent = []) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const content = extraContent.length > 0
    ? [{ type: 'text', text: prompt }, ...extraContent]
    : prompt;
  const { data } = await axios.post(
    ANTHROPIC_URL,
    { model: 'claude-sonnet-4-6', max_tokens: maxTokens, messages: [{ role: 'user', content }] },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 120000,
    },
  );
  return data.content[0].text.trim();
}

function parsearRespostaEdson(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error('Resposta da IA não é JSON válido');
  }

  const criterios = parsed.criterios_score || {};
  const score = calcularScore(criterios);

  return { parsed, criterios, score };
}

async function salvarAnalise(analiseId, parsed, criterios, score, itensPNCP = []) {
  if ((!parsed.itens || parsed.itens.length === 0) && itensPNCP.length > 0) {
    parsed.itens = itensPNCP.slice(0, 100).map(i => ({
      numero: i.numeroItem, descricao: i.descricao,
      unidade: i.unidadeMedida, quantidade: i.quantidade,
      valor_unitario_estimado: i.valorUnitarioEstimado,
    }));
  }

  await db.query(
    `UPDATE analises_edson SET
       status = 'pronto',
       score = $2, score_justificativa = $3, resumo_executivo = $4,
       modalidade = $5, modo_disputa = $6, tipo_julgamento = $7,
       itens = $8, habilitacao = $9, riscos = $10, checklist = $11,
       criterios_score = $12,
       tipo_fornecimento = $13, entrega_tipo = $14, julgamento_tipo = $15,
       locais_entrega = $16, prazo_entrega = $17,
       habilitacao_juridica_json = $18, habilitacao_economica_json = $19, capacidade_tecnica_json = $20,
       atualizado_em = NOW()
     WHERE id = $1`,
    [
      analiseId, score,
      parsed.score_justificativa ?? null,
      parsed.resumo_executivo ?? null,
      parsed.modalidade ?? null,
      parsed.modo_disputa ?? null,
      parsed.tipo_julgamento ?? null,
      JSON.stringify(parsed.itens ?? []),
      JSON.stringify(parsed.habilitacao ?? []),
      JSON.stringify(parsed.riscos ?? []),
      JSON.stringify(parsed.checklist ?? { antes: [], durante: [] }),
      JSON.stringify(criterios),
      parsed.tipo_fornecimento ?? null,
      parsed.entrega_tipo ?? null,
      parsed.julgamento_tipo ?? null,
      parsed.locais_entrega ?? null,
      parsed.prazo_entrega ?? null,
      JSON.stringify(parsed.habilitacao_juridica ?? []),
      JSON.stringify(parsed.habilitacao_economica ?? {}),
      JSON.stringify(parsed.capacidade_tecnica ?? {}),
    ],
  );
}

async function salvarErro(analiseId, msg) {
  await db.query(
    `UPDATE analises_edson SET status = 'erro', erro_mensagem = $2, atualizado_em = NOW() WHERE id = $1`,
    [analiseId, msg],
  );
}

// ── Análises ──────────────────────────────────────────────────────────────────

async function analisarPregao(analiseId, pregaoId) {
  try {
    const { rows: [pregao] } = await db.query(
      `SELECT p.*, c.nome, c.uf, c.palavras_chave
       FROM pregoes p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.id = $1`,
      [pregaoId],
    );
    if (!pregao) throw new Error('Pregão não encontrado');

    let itensPNCP = [];
    if (pregao.numero_controle_pncp) {
      try {
        const { cnpj, ano, seq } = parsearControle(pregao.numero_controle_pncp);
        itensPNCP = await buscarItensPNCP(cnpj, ano, seq);
        console.log(`[Edson] PNCP ${pregao.numero_controle_pncp}: ${itensPNCP.length} item(s)`);
      } catch (e) {
        console.warn('[Edson] Falha ao parsear controle:', e.message);
      }
    }

    const dataSessao = await buscarDataSessao(pregao);
    const raw = await callClaude(buildPrompt(pregao, itensPNCP, dataSessao));
    const { parsed, criterios, score } = parsearRespostaEdson(raw);
    await salvarAnalise(analiseId, parsed, criterios, score, itensPNCP);
    gerarPerguntasProativas(analiseId).catch(e => console.warn('[Edson] Perguntas proativas:', e.message));
  } catch (e) {
    console.error('[Edson] Erro na análise:', e.message);
    await salvarErro(analiseId, e.message);
  }
}

async function analisarPDF(analiseId, pregaoId, pdfBuffer) {
  try {
    const pdfData = await pdfParse(pdfBuffer);
    const pdfText = pdfData.text.trim().slice(0, 30000);
    if (!pdfText) throw new Error('Não foi possível extrair texto do PDF');

    console.log(`[Edson] PDF analise ${analiseId}: ${pdfText.length} chars extraídos`);

    const { rows: [pregao] } = await db.query(
      `SELECT p.*, c.nome, c.uf, c.palavras_chave
       FROM pregoes p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.id = $1`,
      [pregaoId],
    );
    if (!pregao) throw new Error('Pregão não encontrado');

    const dataSessao = await buscarDataSessao(pregao);
    const raw = await callClaude(buildPromptPDF(pregao, pdfText, dataSessao));
    const { parsed, criterios, score } = parsearRespostaEdson(raw);
    await salvarAnalise(analiseId, parsed, criterios, score);
    gerarPerguntasProativas(analiseId).catch(e => console.warn('[Edson] Perguntas proativas:', e.message));
  } catch (e) {
    console.error('[Edson] Erro no PDF:', e.message);
    await salvarErro(analiseId, e.message);
  }
}

async function analisarAvulso(analiseId, opts) {
  try {
    const { numero_controle_pncp, referencia, clienteNome, clienteUF, palavrasChave, pdfBuffer } = opts;

    let itensPNCP = [];
    let pdfText   = null;

    if (pdfBuffer) {
      const pdfData = await pdfParse(pdfBuffer);
      pdfText = pdfData.text.trim().slice(0, 30000);
      console.log(`[Edson] Avulso PDF ${analiseId}: ${pdfText?.length || 0} chars`);
    } else if (numero_controle_pncp) {
      try {
        const { cnpj, ano, seq } = parsearControle(numero_controle_pncp);
        itensPNCP = await buscarItensPNCP(cnpj, ano, seq);
        console.log(`[Edson] Avulso PNCP ${numero_controle_pncp}: ${itensPNCP.length} item(s)`);
      } catch (e) {
        console.warn('[Edson] Avulso PNCP parse falhou:', e.message);
      }
    }

    const raw = await callClaude(buildPromptAvulso(opts, itensPNCP, pdfText));
    const { parsed, criterios, score } = parsearRespostaEdson(raw);
    await salvarAnalise(analiseId, parsed, criterios, score, itensPNCP);
    gerarPerguntasProativas(analiseId).catch(e => console.warn('[Edson] Perguntas proativas:', e.message));
  } catch (e) {
    console.error('[Edson] Erro avulso:', e.message);
    await salvarErro(analiseId, e.message);
  }
}

// ── Perguntas proativas pós-análise ──────────────────────────────────────────

async function gerarPerguntasProativas(analiseId) {
  const { rows: [a] } = await db.query(
    `SELECT ae.score, ae.resumo_executivo, ae.riscos, ae.referencia,
            p.numero, p.orgao, p.objeto, p.valor_estimado
     FROM analises_edson ae
     LEFT JOIN pregoes p ON p.id = ae.pregao_id
     WHERE ae.id = $1`,
    [analiseId],
  );
  if (!a) return;

  const riscos = Array.isArray(a.riscos) ? a.riscos : (() => { try { return JSON.parse(a.riscos || '[]'); } catch { return []; } })();
  const top3 = riscos.slice(0, 3).map(r => r.risco || String(r)).join(' | ') || '—';
  const objeto = a.objeto || a.referencia || '—';

  const resposta = await chamarClaude(
    'Você é o Edson, especialista sênior em licitações. Responda de forma direta e prática.',
    [{ role: 'user', content: `Análise concluída: "${objeto}" | Score: ${a.score}/100 | Riscos: ${top3}\n\nGere EXATAMENTE 3 perguntas diagnósticas que o consultor deve responder antes de decidir participar. Retorne apenas as 3 perguntas numeradas, sem introdução.` }],
  );

  await db.query(
    `INSERT INTO chat_edson (analise_id, role, content) VALUES ($1, 'assistant', $2)`,
    [analiseId, resposta],
  );
}

// ── Reanálise com suplementos (imagem PNCP + arquivo complementar) ────────────

function buildPromptReanalise(analise, complementarNote) {
  const palavrasChave = Array.isArray(analise.palavras_chave)
    ? analise.palavras_chave.join(', ')
    : analise.palavras_chave || '—';

  return `Você é o Edson, assistente especialista em licitações públicas brasileiras do ConlicitHub.

REGRA ABSOLUTA: Nunca invente, assuma ou deduza informações não explicitamente presentes nos documentos fornecidos.

Você recebeu informações complementares para uma licitação. Refaça a análise completa incorporando todos os dados disponíveis. Responda APENAS com um JSON válido com exatamente esta estrutura:

{
  "criterios_score": {
    "alinhamento_objeto": <0-25>,
    "complexidade_habilitacao": <0-20>,
    "valor_viabilidade": <0-20>,
    "modo_disputa": <0-15>,
    "risco_juridico": <0-10>,
    "prazo_adequado": <0-10>
  },
  "score_justificativa": "<2-3 frases>",
  "resumo_executivo": "<3-4 frases>",
  "modalidade": "<str>", "modo_disputa": "<str>", "tipo_julgamento": "<str>",
  "itens": [ { "numero": <int>, "descricao": "<str>", "unidade": "<str>", "quantidade": <number>, "valor_unitario_estimado": <number> } ],
  "habilitacao": [ { "categoria": "<str>", "documentos": [ { "nome": "<str>", "obrigatorio": <bool> } ] } ],
  "riscos": [ { "risco": "<str>", "nivel": "<Alto|Médio|Baixo>", "recomendacao": "<str>" } ],
  "checklist": { "antes": ["<str>"], "durante": ["<str>"] },
  "tipo_fornecimento": "<produto|servico>",
  "entrega_tipo": "<integral|parcelada|null>",
  "julgamento_tipo": "<por_item|por_lote|global>",
  "locais_entrega": "<string ou null>",
  "prazo_entrega": "<string ou null>",
  "habilitacao_juridica": ["<doc 1>"],
  "habilitacao_economica": { "exige_balanco": <bool>, "capital_minimo": "<valor ou null>", "detalhes": "<string>" },
  "capacidade_tecnica": { "exige_atestado": <bool>, "descricao": "<string>" }
}

${RUBRICA_INSTRUCAO}

DADOS DO PREGÃO:
- Número/Ref: ${analise.numero || analise.referencia || '—'}
- Órgão: ${analise.orgao || '—'}
- Objeto: ${analise.objeto || '—'}
- Valor estimado: ${analise.valor_estimado ? `R$ ${analise.valor_estimado}` : '—'}
- Cliente: ${analise.cliente_nome || '—'} (${analise.uf || '—'})
- Palavras-chave: ${palavrasChave}
${complementarNote}

Responda APENAS com o JSON, nenhum texto adicional.`;
}

async function reanalisarComSuplementos(analiseId) {
  try {
    const { rows: [analise] } = await db.query(
      `SELECT ae.*,
              p.numero, p.orgao, p.objeto, p.valor_estimado, p.data_hora_abertura,
              c.nome AS cliente_nome, c.uf, c.palavras_chave
       FROM analises_edson ae
       LEFT JOIN pregoes p ON p.id = ae.pregao_id
       LEFT JOIN clientes c ON c.id = CASE WHEN ae.pregao_id IS NOT NULL THEN p.cliente_id ELSE ae.cliente_id END
       WHERE ae.id = $1`,
      [analiseId],
    );
    if (!analise) throw new Error('Análise não encontrada');

    await db.query(
      `UPDATE analises_edson SET status = 'processando', atualizado_em = NOW() WHERE id = $1`,
      [analiseId],
    );

    const complementarNote = analise.arquivo_complementar_texto
      ? `\nDOCUMENTO COMPLEMENTAR (Termo de Referência / Anexo de Itens):\n${analise.arquivo_complementar_texto.slice(0, 8000)}\nUse as informações acima para complementar a análise, especialmente a lista de itens.`
      : '';

    const extraContent = [];
    if (analise.imagem_pncp_base64) {
      const mediaType = analise.imagem_pncp_base64.startsWith('data:image/png') ? 'image/png'
                      : analise.imagem_pncp_base64.startsWith('data:image/webp') ? 'image/webp'
                      : 'image/jpeg';
      const data = analise.imagem_pncp_base64.replace(/^data:[^;]+;base64,/, '');
      extraContent.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
      extraContent.push({ type: 'text', text: 'A imagem acima contém informações do PNCP sobre este edital (valor estimado, itens, etc). Use essas informações para complementar a análise.' });
    }

    const prompt = buildPromptReanalise(analise, complementarNote);
    const raw = await callClaude(prompt, 4096, extraContent);
    const { parsed, criterios, score } = parsearRespostaEdson(raw);
    await salvarAnalise(analiseId, parsed, criterios, score);
    gerarPerguntasProativas(analiseId).catch(e => console.warn('[Edson] Perguntas proativas:', e.message));
  } catch (e) {
    console.error('[Edson] reanalisarComSuplementos:', e.message);
    await salvarErro(analiseId, e.message);
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────

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

module.exports = { analisarPregao, analisarPDF, analisarAvulso, reanalisarComSuplementos, chamarClaude };
