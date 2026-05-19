const axios = require('axios');
const db = require('../database/db');

const BASE = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/consulta/v1';
const TAMANHO_PAGINA = 50;
const CONCORRENCIA   = 5;   // páginas paralelas por lote (respeitoso ao PNCP e ao Supabase)
const TIMEOUT_MS     = 25000;
const MAX_TENTATIVAS = 3;

function dStr(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function buscarPagina(dataIni, dataFim, pagina) {
  for (let t = 0; t < MAX_TENTATIVAS; t++) {
    try {
      const r = await axios.get(`${BASE}/contratacoes/proposta`, {
        params: { dataInicial: dataIni, dataFinal: dataFim, pagina, tamanhoPagina: TAMANHO_PAGINA },
        timeout: TIMEOUT_MS,
      });
      return { data: r.data.data ?? [], total: r.data.totalRegistros ?? 0 };
    } catch {
      if (t < MAX_TENTATIVAS - 1) await new Promise((r) => setTimeout(r, 2000 * (t + 1)));
    }
  }
  return { data: [], total: 0 };
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

  for (let pInicio = 1; pInicio <= totalPaginas; pInicio += CONCORRENCIA) {
    const lote = Array.from(
      { length: Math.min(CONCORRENCIA, totalPaginas - pInicio + 1) },
      (_, i) => pInicio + i,
    );

    // 1. Busca as páginas do PNCP em paralelo
    const resultados = await Promise.all(lote.map((p) => buscarPagina(dataIni, dataFim, p)));

    // 2. Upsert de cada página no banco (1 query por página)
    for (const { data } of resultados) {
      if (data.length === 0) continue;
      try {
        await upsertPagina(data);
        inseridos += data.length;
      } catch (e) {
        erros += data.length;
        console.error('[Sync] Erro upsert batch:', e.message);
      }
    }

    if ((pInicio - 1) % 50 === 0) {
      const progresso = Math.min(pInicio + CONCORRENCIA - 1, totalPaginas);
      console.log(`[Sync] ${progresso}/${totalPaginas} págs | ${inseridos} inseridos | ${erros} erros`);
    }
  }

  await db.query(`DELETE FROM editais_cache WHERE data_encerramento < NOW() - INTERVAL '7 days'`);

  const duracaoSegundos = Math.round((Date.now() - inicio.getTime()) / 1000);
  const resultado = { total, inseridos, erros, duracaoSegundos };
  console.log('[Sync] Concluído:', JSON.stringify(resultado));
  return resultado;
}

async function contarCacheAtivo() {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS n FROM editais_cache WHERE data_encerramento >= NOW()`,
  );
  return Number(rows[0].n);
}

module.exports = { sincronizarPNCP, contarCacheAtivo };
