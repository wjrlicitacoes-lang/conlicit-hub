const axios = require('axios');
const db = require('../database/db');
const pncpAgent = require('../lib/pncpAgent');

const BASE = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/consulta/v1';

const CATEGORIAS_SEG = ['Engenharia civil','TI e redes','Saúde e material hospitalar','Serviços administrativos','Alimentação e nutrição','Limpeza e conservação','Outros'];

async function classificarSegmentacao(objeto) {
  try {
    const r = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5',
        max_tokens: 20,
        messages: [{ role: 'user', content: `Classifique em UMA das categorias: ${CATEGORIAS_SEG.join(', ')}. Responda APENAS o nome exato da categoria, sem explicação.\n\nObjeto: ${(objeto || '').slice(0, 300)}` }],
      },
      {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        timeout: 8000,
      },
    );
    const cat = r.data?.content?.[0]?.text?.trim();
    return CATEGORIAS_SEG.includes(cat) ? cat : 'Outros';
  } catch {
    return 'Outros';
  }
}

async function classificarEditaisNovos() {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const { rows } = await db.query(
    `SELECT numero_controle_pncp, objeto FROM editais_cache WHERE segmentacao IS NULL AND objeto IS NOT NULL LIMIT 50`,
  ).catch(() => ({ rows: [] }));
  for (const row of rows) {
    const seg = await classificarSegmentacao(row.objeto);
    await db.query(`UPDATE editais_cache SET segmentacao = $1 WHERE numero_controle_pncp = $2`, [seg, row.numero_controle_pncp]).catch(() => {});
  }
  if (rows.length > 0) console.log(`[Sync] Segmentação: ${rows.length} editais classificados`);
}
const TAMANHO_PAGINA       = 50;
const CONCORRENCIA         = 3;      // era 5 — menos pressão simultânea sobre a API do PNCP
const TIMEOUT_MS           = 20000;  // era 12000 — o PNCP costuma ser lento sob concorrência
const MAX_TENTATIVAS       = 2;
const TIMEOUT_MS_RETRY     = 30000;  // timeout maior na fila de retentativa final
const MAX_TENTATIVAS_RETRY = 3;

function dStr(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// tentativas: quantas vezes tentar, timeoutMs: timeout por tentativa
async function buscarPagina(dataIni, dataFim, pagina, tentativas = MAX_TENTATIVAS, timeoutMs = TIMEOUT_MS) {
  for (let t = 0; t < tentativas; t++) {
    try {
      const r = await axios.get(`${BASE}/contratacoes/proposta`, {
        params: { dataInicial: dataIni, dataFinal: dataFim, pagina, tamanhoPagina: TAMANHO_PAGINA },
        httpsAgent: pncpAgent,
        timeout: timeoutMs,
      });
      return { data: r.data.data ?? [], total: r.data.totalRegistros ?? 0, falhou: false };
    } catch (e) {
      console.error('[PNCP Sync] página', pagina, 'tentativa', t + 1, e.code || e.message);
      if (t < tentativas - 1) await new Promise((r) => setTimeout(r, 2000 * (t + 1)));
    }
  }
  // Marca explicitamente como falha (diferente de "página vazia porque não tem mais dados")
  return { data: [], total: 0, falhou: true };
}

// Upsert de uma página inteira numa única query (1 round-trip ao banco por página de 50)
async function upsertPagina(itens) {
  if (itens.length === 0) return 0;

  const cols = 13;
  const placeholders = itens.map((_, i) => {
    const base = i * cols;
    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13})`;
  }).join(',');

  const params = itens.flatMap((item) => {
    const u = item.unidadeOrgao ?? {};
    return [
      item.numeroControlePNCP ?? null,
      item.orgaoEntidade?.cnpj ?? null,
      item.orgaoEntidade?.razaoSocial ?? null,
      item.objetoCompra ?? null,
      item.valorTotalEstimado ?? null,
      item.dataPublicacaoPncp        ? item.dataPublicacaoPncp.slice(0, 10)        : null,
      item.dataEncerramentoProposta  ? item.dataEncerramentoProposta.slice(0, 10)  : null,
      u.ufSigla ?? null,
      u.municipioNome ?? null,
      item.anoCompra ?? null,
      item.sequencialCompra ?? null,
      item.modalidadeNome ?? null,
      JSON.stringify(item),
    ];
  });

  await db.query(
    `INSERT INTO editais_cache
       (numero_controle_pncp, orgao_cnpj, orgao_nome, objeto, valor_estimado,
        data_publicacao, data_encerramento, uf, municipio,
        ano_compra, sequencial_compra, modalidade_nome, raw)
     VALUES ${placeholders}
     ON CONFLICT (numero_controle_pncp) DO UPDATE SET
       orgao_nome        = EXCLUDED.orgao_nome,
       objeto            = EXCLUDED.objeto,
       valor_estimado    = EXCLUDED.valor_estimado,
       data_encerramento = EXCLUDED.data_encerramento,
       raw               = EXCLUDED.raw,
       sincronizado_em   = NOW()`,
    params,
  );

  return itens.length;
}

// Sincroniza editais do PNCP com encerramento nos próximos `diasAdiante` dias.
async function sincronizarPNCP({ diasAdiante = 90 } = {}) {
  const inicio = new Date();
  const hoje   = new Date();
  const dataIni = dStr(hoje);
  const dataFim = dStr(new Date(hoje.getTime() + diasAdiante * 86400000));

  console.log(`[Sync] Iniciando sincronização PNCP: ${dataIni} → ${dataFim}`);

  const { total } = await buscarPagina(dataIni, dataFim, 1);
  if (total === 0) {
    console.log('[Sync] Nenhum edital retornado pelo PNCP — abortando');
    return { total: 0, inseridos: 0, erros: 0, duracaoSegundos: 0 };
  }

  const totalPaginas = Math.ceil(total / TAMANHO_PAGINA);
  console.log(`[Sync] Total PNCP: ${total} editais em ${totalPaginas} páginas`);

  let inseridos = 0;
  let erros     = 0;
  const paginasFalhadas = [];

  for (let pInicio = 1; pInicio <= totalPaginas; pInicio += CONCORRENCIA) {
    const lote = Array.from(
      { length: Math.min(CONCORRENCIA, totalPaginas - pInicio + 1) },
      (_, i) => pInicio + i,
    );

    // 1. Busca as páginas do PNCP em paralelo
    const resultados = await Promise.all(lote.map((p) => buscarPagina(dataIni, dataFim, p)));

    // 2. Upsert de cada página no banco (1 query por página), aguardando antes do próximo lote
    for (let i = 0; i < resultados.length; i++) {
      const { data, falhou } = resultados[i];
      const pagina = lote[i];
      if (falhou) {
        paginasFalhadas.push(pagina); // ← não descarta: guarda pra reprocessar depois
        continue;
      }
      if (data.length === 0) continue;
      try {
        await upsertPagina(data);
        inseridos += data.length;
      } catch (e) {
        erros += data.length;
        console.error('[Sync] Erro upsert batch (página', pagina, '):', e.message);
      }
    }

    if ((pInicio - 1) % 50 === 0) {
      const progresso = Math.min(pInicio + CONCORRENCIA - 1, totalPaginas);
      console.log(`[Sync] ${progresso}/${totalPaginas} págs | ${inseridos} inseridos | ${erros} erros | ${paginasFalhadas.length} p/ retentar`);
    }
  }

  // 3. Fila de retentativa: reprocessa sequencialmente (sem concorrência) as páginas que falharam,
  //    com timeout maior e mais tentativas — em vez de simplesmente perder esses editais.
  if (paginasFalhadas.length > 0) {
    console.log(`[Sync] Reprocessando ${paginasFalhadas.length} página(s) que falharam:`, paginasFalhadas.join(', '));
    const aindaFalharam = [];
    for (const pagina of paginasFalhadas) {
      const { data, falhou } = await buscarPagina(dataIni, dataFim, pagina, MAX_TENTATIVAS_RETRY, TIMEOUT_MS_RETRY);
      if (falhou) {
        aindaFalharam.push(pagina);
        continue;
      }
      if (data.length > 0) {
        try {
          await upsertPagina(data);
          inseridos += data.length;
        } catch (e) {
          erros += data.length;
          console.error('[Sync] Erro upsert retentativa (página', pagina, '):', e.message);
        }
      }
    }
    if (aindaFalharam.length > 0) {
      console.error(`[Sync] ATENÇÃO: ${aindaFalharam.length} página(s) continuam falhando após retentativa:`, aindaFalharam.join(', '));
    } else {
      console.log('[Sync] Todas as páginas pendentes foram recuperadas na retentativa.');
    }
  }

  await db.query(`DELETE FROM editais_cache WHERE data_encerramento < NOW() - INTERVAL '7 days'`);

  const duracaoSegundos = Math.round((Date.now() - inicio.getTime()) / 1000);
  const resultado = { total, inseridos, erros, paginasFalhadasFinal: paginasFalhadas.length, duracaoSegundos };
  console.log('[Sync] Concluído:', JSON.stringify(resultado));

  // Classifica segmentação dos editais sem categoria (roda em background, sem bloquear)
  classificarEditaisNovos().catch(e => console.error('[Sync] Erro classificação segmentação:', e.message));

  return resultado;
}

async function contarCacheAtivo() {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS n FROM editais_cache WHERE data_encerramento >= NOW()`,
  );
  return Number(rows[0].n);
}

module.exports = { sincronizarPNCP, contarCacheAtivo, classificarEditaisNovos };
