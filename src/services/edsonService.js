const axios    = require('axios');
const pdfParse = require('pdf-parse');
const db = require('../database/db');
const { INSTRUCAO_JURIDICA_BASICA, INSTRUCAO_EXEQUIBILIDADE } = require('./edsonJuridicoInstrucao');

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

// ── Prompts — Lei 14.133/2021 ─────────────────────────────────────────────────

const RUBRICA_INSTRUCAO = `
RUBRICA DE SCORE — preencha cada critério com o valor numérico indicado:
{
  "criterios_score": {
    "alinhamento_objeto": <0-25>,       // 25=objeto exato do segmento do cliente; 0=sem relação
    "complexidade_habilitacao": <0-20>, // 20=só declarações/SICAF; 0=atestado técnico complexo ou balanço exigente
    "valor_viabilidade": <0-20>,        // 20=valor alto e rentável; 0=valor sigiloso ou abaixo do custo mínimo
    "modo_disputa": <0-15>,             // 15=aberto por item; 5=fechado ou global; 0=sem informação
    "risco_juridico": <0-10>,           // 10=edital sem irregularidades; 0=múltiplas cláusulas restritivas
    "prazo_adequado": <0-10>            // 10=prazo >5 dias úteis; 5=2-5 dias úteis; 0=<2 dias ou já encerrado
  }
}
NÃO inclua campo "score" — o sistema calcula a soma automaticamente.`;

// ── Base de conhecimento Lei 14.133/2021 ──────────────────────────────────────

const BASE_LEGAL_RESUMO = `
LEGISLAÇÃO APLICÁVEL — Lei 14.133/2021:
- Pregão Eletrônico obrigatório para bens/serviços comuns (art.176)
- Dispensa eletrônica até R$57.208,33 (art.75,II)
- Habilitação: Jurídica(art.66), Fiscal(art.68), Econômica(art.69), Técnica(art.67)
- Atestado técnico: PROIBIDO exigir >50% do objeto (Súmula 272 TCU) ou >3 atestados
- Capital social mínimo: limitado a 10% do valor estimado (art.69,§2°)
- Empresa: PROIBIDO exigir existência >1 ano (art.67,§1°)
- Prazos: impugnação até 3 dias úteis antes (art.164); recurso 3 dias úteis após habilitação (art.165)
- ME/EPP: exclusividade obrigatória ≤R$80.000 (art.48 LC123); empate ficto até 5% (art.44 LC123)
- Cláusulas restritivas ilegais: art.9° — direcionamento, restrição geográfica sem justificativa técnica
- Fracionamento ilegal: art.8°,§1°
`;

// ── Estrutura JSON de saída — instrução compacta ─────────────────────────────

const JSON_SCHEMA_INSTRUCAO = `
Responda APENAS com JSON válido contendo exatamente estes campos de nível raiz:
numero_pregao, orgao, valor_estimado, data_abertura, uf,
criterios_score, score_justificativa, resumo_executivo, modalidade, modo_disputa,
tipo_julgamento, itens, habilitacao, clausulas_restritivas, prazos_legais,
beneficios_me_epp, riscos, checklist, tipo_fornecimento, entrega_tipo,
julgamento_tipo, locais_entrega, prazo_entrega, habilitacao_juridica,
habilitacao_economica, capacidade_tecnica.

Campos de identificação — extraia diretamente do texto do edital (retorne null se não encontrar):
- numero_pregao: número/identificador do pregão ou licitação (ex: "PE 001/2026", "012/2026") — NÃO é o objeto
- orgao: nome completo do órgão ou entidade licitante
- valor_estimado: valor estimado total em número (ex: 150000.00) — null se sigiloso ou não informado
- data_abertura: data e hora da sessão de abertura como string (ex: "29/05/2026 09:00") — null se não encontrar
- uf: sigla do estado do órgão licitante (2 letras, ex: "MG") — null se não identificado

Tipos obrigatórios:
- criterios_score: objeto com 6 números (alinhamento_objeto 0-25, complexidade_habilitacao 0-20, valor_viabilidade 0-20, modo_disputa 0-15, risco_juridico 0-10, prazo_adequado 0-10)
- itens: array de {numero, descricao, unidade, quantidade, valor_unitario_estimado}
- habilitacao: array de {categoria, documentos:[{nome, obrigatorio, base_legal}]}
- clausulas_restritivas: array de {clausula, violacao, recomendacao} — vazio [] se não houver
- prazos_legais: {data_sessao, prazo_impugnacao, prazo_esclarecimento, dias_uteis_restantes, alerta_prazo}
- beneficios_me_epp: {exclusividade_obrigatoria, exclusividade_prevista, empate_ficto_aplicavel, alerta}
- riscos: array de {risco, nivel, base_legal, recomendacao} — mínimo 4
- checklist: {antes:[strings], durante:[strings], apos:[strings]}
- habilitacao_economica: {exige_balanco, capital_minimo, detalhes}
- capacidade_tecnica: {exige_atestado, descricao}
Sem markdown, sem texto fora do JSON.`;

const INSTRUCOES_ANALISE = `
=== INSTRUÇÕES DE ANÁLISE — APLIQUE SEMPRE ===

REGRA 1 — CLÁUSULAS RESTRITIVAS:
Verifique ATIVAMENTE se o edital contém qualquer das situações abaixo e preencha "clausulas_restritivas":
- Atestado com quantitativo > 50% do objeto → viola Súmula 272 TCU
- Capital social mínimo > 10% do valor estimado → viola art. 69, §2°, Lei 14.133/2021
- Exigência de tempo de existência da empresa > 1 ano → viola art. 67, §1°, Lei 14.133/2021
- Exigência de execução anterior no mesmo órgão → cláusula restritiva ilegal
- Registro em entidade profissional não previsto em lei para o objeto → viola art. 9°, III
- Objeto sigiloso sem justificativa → dificulta competição, pode ser impugnado
- Prazo entre publicação e abertura inferior a 8 dias úteis → viola art. 55, I (Pregão)
Se não houver cláusulas restritivas, retorne "clausulas_restritivas": [].

REGRA 2 — PRAZOS LEGAIS:
Calcule "prazos_legais" com base na data da sessão informada.
- Prazo de impugnação = data da sessão − 3 dias úteis
- Prazo de esclarecimento = data da sessão − 3 dias úteis
- "dias_uteis_restantes" = dias úteis entre hoje e a data da sessão
- "alerta_prazo": URGENTE se < 2 dias úteis; ATENÇÃO se 2–3 dias úteis; OK se > 3 dias úteis
Desconsidere sábados, domingos e feriados nacionais do cálculo.

REGRA 3 — BENEFÍCIOS ME/EPP:
- Se valor estimado ≤ R$ 80.000,00: "exclusividade_obrigatoria" = true. Se o edital não prevê exclusividade, incluir alerta.
- Se valor > R$ 80.000,00 com itens divisíveis ≤ R$ 80.000,00: verificar se cota reservada está prevista.
- Sempre calcule "empate_ficto_aplicavel" = true para pregões (salvo dispensa ou inexigibilidade).

REGRA 4 — HABILITAÇÃO TÉCNICA:
Preencha "capacidade_tecnica.legal":
- false se o edital exige atestado com quantitativo específico E esse quantitativo supera 50% do objeto
- false se exige mais de 3 atestados para o mesmo serviço
- true nos demais casos
Sempre informe o quantitativo exigido em "quantitativo_exigido".

REGRA 5 — QUALIDADE DA ANÁLISE:
- Cite artigos da Lei 14.133/2021, LC 123/2006 ou Súmulas do TCU em TODOS os campos que envolvam legalidade.
- "riscos": mínimo 4 riscos, sempre com "base_legal" quando aplicável.
- "checklist.antes": mínimo 8 itens específicos ao edital analisado.
- "checklist.durante": mínimo 5 itens com referência a prazos da sessão.
- "checklist.apos": mínimo 3 itens (homologação, contrato, publicação).
- Nunca use linguagem genérica tipo "verificar documentação" — seja específico ao objeto e ao edital.

REGRA ABSOLUTA — JSON VÁLIDO:
- Responda APENAS com o JSON. Sem markdown, sem texto antes ou depois.
- NUNCA omita campos — use null ou [] para campos sem informação.
- Todos os números devem ser numbers (não strings): "quantidade": 10, não "quantidade": "10".
`;

// ── Funções de build de prompt ────────────────────────────────────────────────

function buildPrompt(pregao, itensPNCP, dataSessao) {
  const itensStr = itensPNCP.length > 0
    ? JSON.stringify(itensPNCP.slice(0, 80).map(i => ({
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

  return `Você é o Edson, especialista jurídico em licitações públicas brasileiras da Conlicit.
Domina a Lei 14.133/2021, LC 123/2006, jurisprudência do TCU e orientações da AGU.
Sua função é analisar pregões com rigor técnico-jurídico e proteger os interesses do cliente.

${BASE_LEGAL_RESUMO}

${INSTRUCOES_ANALISE}

${RUBRICA_INSTRUCAO}

Responda APENAS com o JSON abaixo, preenchido com a análise do pregão:
${JSON_SCHEMA_INSTRUCAO}

=== DADOS DO PREGÃO ===
Número: ${pregao.numero || '—'}
Órgão: ${pregao.orgao || '—'}
Objeto: ${pregao.objeto || '—'}
Valor estimado: ${pregao.valor_estimado ? `R$ ${Number(pregao.valor_estimado).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '—'}
Data da sessão: ${dataSessao}
${pregao.numero_controle_pncp ? `Nº Controle PNCP: ${pregao.numero_controle_pncp}` : ''}
Modalidade informada: ${pregao.modalidade || '—'}

=== PERFIL DO CLIENTE ===
Nome: ${pregao.nome || '—'}
UF: ${pregao.uf || '—'}
Segmento/palavras-chave: ${palavrasChave}

=== ITENS DO EDITAL (via PNCP) ===
${itensStr}

Analise TODOS os dados acima aplicando as 5 regras de análise. Responda APENAS com o JSON.`;
}

function buildPromptPDF(pregao, pdfText, dataSessao) {
  const palavrasChave = Array.isArray(pregao.palavras_chave)
    ? pregao.palavras_chave.join(', ')
    : pregao.palavras_chave || '—';

  return `Você é o Edson, especialista jurídico em licitações públicas brasileiras da Conlicit.
Domina a Lei 14.133/2021, LC 123/2006, jurisprudência do TCU e orientações da AGU.
Sua função é analisar editais com rigor técnico-jurídico e proteger os interesses do cliente.

${BASE_LEGAL_RESUMO}

${INSTRUCOES_ANALISE}

${RUBRICA_INSTRUCAO}

${INSTRUCAO_JURIDICA_BASICA}

${INSTRUCAO_EXEQUIBILIDADE}

Responda APENAS com o JSON abaixo, preenchido com a análise do edital:
${JSON_SCHEMA_INSTRUCAO}

=== DADOS DO PREGÃO ===
Número: ${pregao.numero || '—'}
Órgão: ${pregao.orgao || '—'}
Objeto: ${pregao.objeto || '—'}
Valor estimado: ${pregao.valor_estimado ? `R$ ${Number(pregao.valor_estimado).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '—'}
Data da sessão: ${dataSessao}
${pregao.numero_controle_pncp ? `Nº Controle PNCP: ${pregao.numero_controle_pncp}` : ''}

=== PERFIL DO CLIENTE ===
Nome: ${pregao.nome || '—'}
UF: ${pregao.uf || '—'}
Segmento/palavras-chave: ${palavrasChave}

=== TEXTO DO EDITAL (extraído do PDF) ===
${pdfText}

Analise o edital COMPLETO acima aplicando as 5 regras. Priorize o texto do edital sobre qualquer inferência. Responda APENAS com o JSON.`;
}

function buildPromptAvulso(opts, itensPNCP, pdfText) {
  const { referencia, numero_controle_pncp, clienteNome, clienteUF, palavrasChave } = opts;

  const itensStr = pdfText
    ? `=== TEXTO DO EDITAL (extraído do PDF) ===\n${pdfText}`
    : itensPNCP.length > 0
      ? `=== ITENS DO EDITAL (via PNCP) ===\n${JSON.stringify(
          itensPNCP.slice(0, 80).map(i => ({
            numero: i.numeroItem,
            descricao: i.descricao,
            unidade: i.unidadeMedida,
            quantidade: i.quantidade,
            valorUnitarioEstimado: i.valorUnitarioEstimado,
          })), null, 2)}`
      : '=== ITENS DO EDITAL ===\nNão disponível — inferir a partir do objeto.';

  return `Você é o Edson, especialista jurídico em licitações públicas brasileiras da Conlicit.
Domina a Lei 14.133/2021, LC 123/2006, jurisprudência do TCU e orientações da AGU.
Sua função é analisar licitações com rigor técnico-jurídico e proteger os interesses do cliente.

${BASE_LEGAL_RESUMO}

${INSTRUCOES_ANALISE}

${RUBRICA_INSTRUCAO}

${INSTRUCAO_JURIDICA_BASICA}

${INSTRUCAO_EXEQUIBILIDADE}

Responda APENAS com o JSON abaixo, preenchido com a análise da licitação:
${JSON_SCHEMA_INSTRUCAO}

=== DADOS DA LICITAÇÃO ===
Referência: ${referencia || '—'}
${numero_controle_pncp ? `Nº Controle PNCP: ${numero_controle_pncp}` : ''}
${clienteNome ? `Cliente: ${clienteNome} (${clienteUF || '—'})` : ''}
${palavrasChave ? `Segmento/palavras-chave: ${palavrasChave}` : ''}

${itensStr}

Analise todos os dados acima aplicando as 5 regras. Responda APENAS com o JSON.`;
}

// ── MODO REUNIÃO — prompt compacto, resposta rápida ──────────────────────────

const JSON_SCHEMA_REUNIAO = `{
  "criterios_score": {
    "alinhamento_objeto": <0-25>,
    "complexidade_habilitacao": <0-20>,
    "valor_viabilidade": <0-20>,
    "modo_disputa": <0-15>,
    "risco_juridico": <0-10>,
    "prazo_adequado": <0-10>
  },
  "score_justificativa": "<2 frases diretas>",
  "resumo_executivo": "<3 frases executivas>",
  "modalidade": "<str>",
  "modo_disputa": "<str>",
  "tipo_julgamento": "<str>",
  "itens": [
    { "numero": <int>, "descricao": "<str>", "unidade": "<str>", "quantidade": <number>, "valor_unitario_estimado": <number|null> }
  ],
  "habilitacao": [
    { "categoria": "<str>", "documentos": [{ "nome": "<str>", "obrigatorio": <bool> }] }
  ],
  "clausulas_restritivas": [
    { "clausula": "<str>", "violacao": "<artigo>", "recomendacao": "<str>" }
  ],
  "prazos_legais": {
    "data_sessao": "<str|null>",
    "prazo_impugnacao": "<str|null>",
    "prazo_esclarecimento": "<str|null>",
    "dias_uteis_restantes": <int>,
    "alerta_prazo": "<null|URGENTE|ATENÇÃO|OK>"
  },
  "beneficios_me_epp": {
    "exclusividade_obrigatoria": <bool>,
    "exclusividade_prevista": <bool>,
    "empate_ficto_aplicavel": <bool>,
    "alerta": "<str|null>"
  },
  "riscos": [
    { "risco": "<str>", "nivel": "<Alto|Médio|Baixo>", "base_legal": "<str|null>", "recomendacao": "<str>" }
  ],
  "checklist": {
    "antes": ["<str>"],
    "durante": ["<str>"],
    "apos": ["<str>"]
  },
  "tipo_fornecimento": "<produto|servico|obra>",
  "entrega_tipo": "<integral|parcelada|null>",
  "julgamento_tipo": "<por_item|por_lote|global>",
  "locais_entrega": "<str|null>",
  "prazo_entrega": "<str|null>",
  "habilitacao_juridica": ["<str>"],
  "habilitacao_economica": { "exige_balanco": <bool>, "capital_minimo": "<str|null>", "detalhes": "<str>" },
  "capacidade_tecnica": { "exige_atestado": <bool>, "descricao": "<str>" }
}`;

function buildPromptReuniao(dados, pdfText, itensPNCP, dataSessao) {
  const objeto = dados.objeto || dados.referencia || '—';
  const orgao  = dados.orgao || '—';
  const valor  = dados.valor_estimado
    ? `R$ ${Number(dados.valor_estimado).toLocaleString('pt-BR', {minimumFractionDigits:2})}`
    : '—';
  const cliente  = dados.nome || dados.clienteNome || '—';
  const uf       = dados.uf || dados.clienteUF || '—';
  const palavras = Array.isArray(dados.palavras_chave)
    ? dados.palavras_chave.join(', ')
    : dados.palavrasChave || dados.palavras_chave || '—';

  const itensStr = pdfText
    ? `TEXTO DO EDITAL:\n${pdfText}`
    : itensPNCP && itensPNCP.length > 0
      ? `ITENS PNCP:\n${JSON.stringify(itensPNCP.slice(0, 40).map(i => ({
          numero: i.numeroItem, descricao: i.descricao,
          unidade: i.unidadeMedida, quantidade: i.quantidade,
          valorUnitarioEstimado: i.valorUnitarioEstimado,
        })), null, 2)}`
      : `OBJETO: ${objeto}`;

  return `Você é o Edson, especialista em licitações públicas (Lei 14.133/2021).
Faça uma análise objetiva e direta para uso em reunião comercial com o cliente.

${BASE_LEGAL_RESUMO}

REGRAS CRÍTICAS:
- Identifique cláusulas restritivas ilegais (atestado >50% objeto: Súmula 272 TCU; capital >10% valor: art.69§2°; tempo empresa >1 ano: art.67§1°)
- Calcule prazo de impugnação (sessão − 3 dias úteis, art.164)
- Verifique exclusividade ME/EPP (obrigatória se valor ≤ R$80.000, art.48 LC123)
- Mínimo 4 riscos com base legal; checklist específico ao edital
- NUNCA use linguagem genérica — referencie o objeto e o edital analisado

DADOS:
Objeto: ${objeto}
Órgão: ${orgao}
Valor estimado: ${valor}
Data da sessão: ${dataSessao || '—'}
Cliente: ${cliente} | UF: ${uf}
Segmento: ${palavras}

${itensStr}

Responda APENAS com este JSON preenchido:
${JSON_SCHEMA_REUNIAO}`;
}

// ── Chamada Claude + parse ────────────────────────────────────────────────────


// ── Segmentador de edital — reduz custo de tokens em ~80% ────────────────────
function segmentarEdital(textoCompleto) {
  const padroes = {
    objeto:      [/DO\s+OBJETO/i, /OBJETO\s+DA\s+LICITA[ÇC][ÃA]O/i, /1[\s\.]+OBJETO/i],
    habilitacao: [/DA\s+HABILITA[ÇC][ÃA]O/i, /DOCUMENTOS?\s+DE\s+HABILITA[ÇC][ÃA]O/i],
    itens:       [/PLANILHA\s+DE\s+PRE[ÇC]OS?/i, /TERMO\s+DE\s+REFER[EÊ]NCIA/i, /ESPECIFICA[ÇC][ÕO]ES?\s+T[EÉ]CNICAS?/i, /ITENS?\s+DA\s+LICITA[ÇC][ÃA]O/i],
    prazos:      [/DOS?\s+PRAZOS?/i, /PRAZO\s+DE\s+ENTREGA/i, /PRAZO\s+DE\s+EXECU[ÇC][ÃA]O/i],
    penalidades: [/DAS?\s+SAN[ÇC][ÕO]ES?/i, /DAS?\s+PENALIDADES?/i],
  };
  const limites = { objeto: 4000, habilitacao: 6000, itens: 10000, prazos: 3000, penalidades: 3000 };
  const secoes = { encontradas: [] };

  for (const [nome, lista] of Object.entries(padroes)) {
    for (const regex of lista) {
      const match = textoCompleto.match(regex);
      if (match) {
        const inicio = Math.max(0, textoCompleto.indexOf(match[0]) - 50);
        secoes[nome] = textoCompleto.slice(inicio, inicio + limites[nome]);
        secoes.encontradas.push(nome);
        break;
      }
    }
  }
  if (!secoes.objeto) { secoes.objeto = textoCompleto.slice(0, 4000); secoes.encontradas.push('objeto_inferido'); }

  const totalEnviado = Object.entries(secoes).filter(([k]) => k !== 'encontradas').reduce((acc, [,v]) => acc + (v||'').length, 0);
  const economia = Math.round((1 - totalEnviado / Math.max(textoCompleto.length, 1)) * 100);
  console.log(`[Edson] Segmentação: ${secoes.encontradas.join(', ')} | ${totalEnviado} chars | economia: ${economia}%`);
  return secoes;
}

function montarContextoPDF(secoes) {
  const partes = [];
  if (secoes.objeto)      partes.push(`[OBJETO]\n${secoes.objeto}`);
  if (secoes.itens)       partes.push(`[ITENS]\n${secoes.itens}`);
  if (secoes.habilitacao) partes.push(`[HABILITAÇÃO]\n${secoes.habilitacao}`);
  if (secoes.prazos)      partes.push(`[PRAZOS]\n${secoes.prazos}`);
  if (secoes.penalidades) partes.push(`[PENALIDADES]\n${secoes.penalidades}`);
  return partes.join('\n\n---\n\n');
}


async function callClaude(prompt, maxTokens = 6000, extraContent = []) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');
  const content = extraContent.length > 0
    ? [{ type: 'text', text: prompt }, ...extraContent]
    : prompt;
  const inputLen = typeof prompt === 'string' ? prompt.length : JSON.stringify(content).length;
  console.log(`[Edson] callClaude: ${inputLen} chars (~${Math.round(inputLen/4)} tokens est.), maxTokens: ${maxTokens}`);
  try {
    const { data } = await axios.post(
      ANTHROPIC_URL,
      { model: process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5', max_tokens: maxTokens, messages: [{ role: 'user', content }] },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: parseInt(process.env.ANTHROPIC_TIMEOUT || '55000', 10),
      },
    );
    return data.content[0].text.trim();
  } catch (e) {
    // Extrair mensagem real do erro da API Anthropic
    const apiError = e.response?.data?.error?.message || e.response?.data?.message;
    const status = e.response?.status;
    if (apiError) {
      console.error(`[Edson] API Anthropic erro ${status}: ${apiError}`);
      throw new Error(`API Anthropic (${status}): ${apiError}`);
    }
    if (e.code === 'ECONNABORTED') {
      console.error(`[Edson] Timeout após ${parseInt(process.env.ANTHROPIC_TIMEOUT || '55000')}ms`);
      throw new Error(`Timeout na análise — tente o modo "reunião" (mais rápido)`);
    }
    throw e;
  }
}

function finalizarParse(parsed) {
  if (!parsed.criterios_score) parsed.criterios_score = {};
  if (!parsed.itens) parsed.itens = [];
  if (!parsed.habilitacao) parsed.habilitacao = [];
  if (!parsed.riscos) parsed.riscos = [];
  if (!parsed.clausulas_restritivas) parsed.clausulas_restritivas = [];
  if (!parsed.checklist) parsed.checklist = { antes: [], durante: [], apos: [] };
  if (!parsed.checklist.antes) parsed.checklist.antes = [];
  if (!parsed.checklist.durante) parsed.checklist.durante = [];
  if (!parsed.checklist.apos) parsed.checklist.apos = [];
  if (!parsed.prazos_legais) parsed.prazos_legais = {};
  if (!parsed.beneficios_me_epp) parsed.beneficios_me_epp = {};
  if (!parsed.habilitacao_economica) parsed.habilitacao_economica = { exige_balanco: false, detalhes: '' };
  if (!parsed.capacidade_tecnica) parsed.capacidade_tecnica = { exige_atestado: false, descricao: '' };
  if (!parsed.resumo_executivo) parsed.resumo_executivo = 'Análise gerada com dados parciais.';
  const score = calcularScore(parsed.criterios_score);
  return { parsed, criterios: parsed.criterios_score, score };
}

function parsearRespostaEdson(raw) {
  let limpo = raw.trim()
    .replace(/^```json\s*/i, '').replace(/```\s*$/i, '')
    .replace(/^```\s*/i, '').replace(/```\s*$/i, '');

  // Tentativa 1: parse direto
  try { return finalizarParse(JSON.parse(limpo)); } catch {}

  // Tentativa 2: extrair maior bloco JSON
  const match = limpo.match(/\{[\s\S]*\}/);
  if (match) {
    try { return finalizarParse(JSON.parse(match[0])); } catch {}
  }

  // Tentativa 3: reparar JSON truncado adicionando fechamentos
  let reparado = limpo;
  let chaves = 0, colchetes = 0;
  for (const c of reparado) {
    if (c === '{') chaves++;
    else if (c === '}') chaves--;
    else if (c === '[') colchetes++;
    else if (c === ']') colchetes--;
  }
  const ultimoChar = reparado.trimEnd().slice(-1);
  if (ultimoChar !== '"' && ultimoChar !== '}' && ultimoChar !== ']') {
    reparado = reparado.trimEnd();
    const ultimaVirgula = reparado.lastIndexOf(',');
    if (ultimaVirgula > reparado.length - 200) {
      reparado = reparado.slice(0, ultimaVirgula);
    }
  }
  reparado += ']'.repeat(Math.max(0, colchetes));
  reparado += '}'.repeat(Math.max(0, chaves));

  try { return finalizarParse(JSON.parse(reparado)); } catch {}

  console.error('[Edson] JSON irrecuperável, usando defaults. Raw:', limpo.slice(0, 300));
  return finalizarParse({});
}

async function salvarAnalise(analiseId, parsed, criterios, score, itensPNCP = [], dadosContexto = {}) {
  if ((!parsed.itens || parsed.itens.length === 0) && itensPNCP.length > 0) {
    parsed.itens = itensPNCP.slice(0, 100).map(i => ({
      numero: i.numeroItem, descricao: i.descricao,
      unidade: i.unidadeMedida, quantidade: i.quantidade,
      valor_unitario_estimado: i.valorUnitarioEstimado,
    }));
  }

  // Campos estruturados — prioridade: Claude → contexto do banco (JOIN) → null
  const orgao         = parsed.orgao         || dadosContexto.orgao         || null;
  const uf            = parsed.uf            || dadosContexto.uf            || null;
  const numero_pregao = parsed.numero_pregao || dadosContexto.numero        || null;
  const data_abertura = parsed.data_abertura || dadosContexto.data_abertura || null;
  const valor_estimado = (parsed.valor_estimado != null && parsed.valor_estimado !== '')
    ? parseFloat(parsed.valor_estimado) || null
    : (dadosContexto.valor_estimado != null ? parseFloat(dadosContexto.valor_estimado) || null : null);

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
       orgao = $21, valor_estimado = $22, data_abertura = $23, uf = $24, numero_pregao = $25,
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
      orgao, valor_estimado, data_abertura, uf, numero_pregao,
    ],
  );

  await db.query(
    `UPDATE analises_edson SET
       clausulas_restritivas = $2,
       prazos_legais         = $3,
       beneficios_me_epp     = $4
     WHERE id = $1`,
    [
      analiseId,
      JSON.stringify(parsed.clausulas_restritivas ?? []),
      JSON.stringify(parsed.prazos_legais ?? {}),
      JSON.stringify(parsed.beneficios_me_epp ?? {}),
    ],
  ).catch(e => console.error('[Edson] ERRO ao salvar clausulas_restritivas/prazos_legais/beneficios_me_epp:', e.message));
}

async function salvarErro(analiseId, msg) {
  await db.query(
    `UPDATE analises_edson SET status = 'erro', erro_mensagem = $2, atualizado_em = NOW() WHERE id = $1`,
    [analiseId, msg],
  );
}

// ── Análises ──────────────────────────────────────────────────────────────────

async function analisarPregao(analiseId, pregaoId, modo = 'completo') {
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
    let prompt, maxTok;
    if (modo === 'reuniao') {
      prompt = buildPromptReuniao(pregao, null, itensPNCP, dataSessao);
      maxTok = 4000;
    } else {
      prompt = buildPrompt(pregao, itensPNCP, dataSessao);
      maxTok = 8000;
    }
    const raw = await callClaude(prompt, maxTok);
    const { parsed, criterios, score } = parsearRespostaEdson(raw);
    await salvarAnalise(analiseId, parsed, criterios, score, itensPNCP, {
      orgao: pregao.orgao, uf: pregao.uf, numero: pregao.numero,
      valor_estimado: pregao.valor_estimado, data_abertura: pregao.data_hora_abertura,
    });
    gerarPerguntasProativas(analiseId).catch(e => console.warn('[Edson] Perguntas proativas:', e.message));
  } catch (e) {
    console.error('[Edson] Erro na análise:', e.message);
    await salvarErro(analiseId, e.message);
  }
}

async function analisarPDF(analiseId, pregaoId, pdfBuffer, modo = 'reuniao') {
  try {
    const pdfData = await pdfParse(pdfBuffer);
    const pdfText = montarContextoPDF(segmentarEdital(pdfData.text.trim()));
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
    let prompt, maxTok;
    if (modo === 'reuniao') {
      prompt = buildPromptReuniao(pregao, pdfText, [], dataSessao);
      maxTok = 4000;
    } else {
      prompt = buildPromptPDF(pregao, pdfText, dataSessao);
      maxTok = 8000;
    }
    const raw = await callClaude(prompt, maxTok);
    const { parsed, criterios, score } = parsearRespostaEdson(raw);
    await salvarAnalise(analiseId, parsed, criterios, score, [], {
      orgao: pregao.orgao, uf: pregao.uf, numero: pregao.numero,
      valor_estimado: pregao.valor_estimado, data_abertura: pregao.data_hora_abertura,
    });
    gerarPerguntasProativas(analiseId).catch(e => console.warn('[Edson] Perguntas proativas:', e.message));
  } catch (e) {
    console.error('[Edson] Erro no PDF:', e.message);
    await salvarErro(analiseId, e.message);
  }
}

async function analisarAvulso(analiseId, opts) {
  try {
    const { numero_controle_pncp, referencia, clienteNome, clienteUF, palavrasChave, pdfBuffer } = opts;
    const modo = opts.modo || 'reuniao';

    let itensPNCP = [];
    let pdfText   = null;

    if (pdfBuffer) {
      const pdfData = await pdfParse(pdfBuffer);
      pdfText = montarContextoPDF(segmentarEdital(pdfData.text.trim()));
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

    let prompt, maxTok;
    if (modo === 'reuniao') {
      prompt = buildPromptReuniao(opts, pdfText, itensPNCP, null);
      maxTok = 4000;
    } else {
      prompt = buildPromptAvulso(opts, itensPNCP, pdfText);
      maxTok = 8000;
    }
    const raw = await callClaude(prompt, maxTok);
    const { parsed, criterios, score } = parsearRespostaEdson(raw);
    await salvarAnalise(analiseId, parsed, criterios, score, itensPNCP, {
      uf: clienteUF || null,
      numero: referencia || null,
    });
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

${INSTRUCAO_JURIDICA_BASICA}

${INSTRUCAO_EXEQUIBILIDADE}

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
    const raw = await callClaude(prompt, 6000, extraContent);
    const { parsed, criterios, score } = parsearRespostaEdson(raw);
    await salvarAnalise(analiseId, parsed, criterios, score, [], {
      orgao: analise.orgao, uf: analise.uf,
      numero: analise.numero || analise.referencia,
      valor_estimado: analise.valor_estimado, data_abertura: analise.data_hora_abertura,
    });
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
    { model: process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5', max_tokens: 4000, system: systemPrompt, messages },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: parseInt(process.env.ANTHROPIC_TIMEOUT || '55000', 10),
    },
  ).catch(e => {
    const apiError = e.response?.data?.error?.message || e.response?.data?.message;
    if (apiError) throw new Error(`API Anthropic (${e.response?.status}): ${apiError}`);
    if (e.code === 'ECONNABORTED') throw new Error('Timeout no chat — tente novamente');
    throw e;
  });
  return data.content[0].text;
}

module.exports = { analisarPregao, analisarPDF, analisarAvulso, reanalisarComSuplementos, chamarClaude, callClaude };
