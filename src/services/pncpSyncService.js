const axios = require('axios');
const db = require('../database/db');

const BASE = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/consulta/v1';
const TAMANHO_PAGINA = 50;
const CONCORRENCIA = 8;   // páginas paralelas por lote
const TIMEOUT_MS  = 25000;
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

async function upsertEdital(item) {
  const u = item.unidadeOrgao ?? {};
  await db.query(
    `INSERT INTO editais_cache
       (numero_controle_pncp, orgao_cnpj, orgao_nome, objeto, valor_estimado,
        data_publicacao, data_encerramento, uf, municipio,
        ano_compra, sequencial_compra, modalidade_nome, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (numero_controle_pncp) DO UPDATE SET
       orgao_nome        = EXCLUDED.orgao_nome,
       objeto            = EXCLUDED.objeto,
       valor_estimado    = EXCLUDED.valor_estimado,
       data_encerramento = EXCLUDED.data_encerramento,
       raw               = EXCLUDED.raw,
       sincronizado_em   = NOW()`,
    [
      item.numeroControlePNCP,
      item.orgaoEntidade?.cnpj ?? null,
      item.orgaoEntidade?.razaoSocial ?? null,
      item.objetoCompra ?? null,
      item.valorTotalEstimado ?? null,
      item.dataPublicacaoPncp ? item.dataPublicacaoPncp.slice(0, 10) : null,
      item.dataEncerramentoProposta ? item.dataEncerramentoProposta.slice(0, 10) : null,
      u.ufSigla ?? null,
      u.municipioNome ?? null,
      item.anoCompra ?? null,
      item.sequencialCompra ?? null,
      item.modalidadeNome ?? null,
      item,
    ],
  );
}

// Sincroniza editais do PNCP com encerramento nos próximos `diasAdiante` dias.
// Roda em lotes de CONCORRENCIA páginas paralelas para equilibrar velocidade e respeito à API.
async function sincronizarPNCP({ diasAdiante = 90 } = {}) {
  const inicio = new Date();
  const hoje = new Date();
  const dataIni = dStr(hoje);
  const dataFim = dStr(new Date(hoje.getTime() + diasAdiante * 86400000));

  console.log(`[Sync] Iniciando sincronização PNCP: ${dataIni} → ${dataFim}`);

  // Descobre o total de páginas
  const { total } = await buscarPagina(dataIni, dataFim, 1);
  if (total === 0) {
    console.log('[Sync] Nenhum edital retornado pelo PNCP — abortando');
    return { total: 0, inseridos: 0, erros: 0, duracaoSegundos: 0 };
  }

  const totalPaginas = Math.ceil(total / TAMANHO_PAGINA);
  console.log(`[Sync] Total PNCP: ${total} editais em ${totalPaginas} páginas`);

  let inseridos = 0;
  let erros = 0;

  for (let pInicio = 1; pInicio <= totalPaginas; pInicio += CONCORRENCIA) {
    const lote = Array.from(
      { length: Math.min(CONCORRENCIA, totalPaginas - pInicio + 1) },
      (_, i) => pInicio + i,
    );

    const resultados = await Promise.all(lote.map((p) => buscarPagina(dataIni, dataFim, p)));

    for (const { data } of resultados) {
      for (const item of data) {
        try {
          await upsertEdital(item);
          inseridos++;
        } catch (e) {
          erros++;
          if (erros <= 5) console.error('[Sync] Erro upsert:', e.message);
        }
      }
    }

    if (pInicio % 50 === 1) {
      console.log(`[Sync] Progresso: ${Math.min(pInicio + CONCORRENCIA - 1, totalPaginas)}/${totalPaginas} págs | ${inseridos} inseridos`);
    }
  }

  // Remove editais cujo encerramento já passou há mais de 7 dias
  await db.query(`DELETE FROM editais_cache WHERE data_encerramento < NOW() - INTERVAL '7 days'`);

  const duracaoSegundos = Math.round((Date.now() - inicio.getTime()) / 1000);
  const resultado = { total, inseridos, erros, duracaoSegundos };
  console.log('[Sync] Concluído:', JSON.stringify(resultado));
  return resultado;
}

// Retorna contagem de editais ativos no cache
async function contarCacheAtivo() {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS n FROM editais_cache WHERE data_encerramento >= NOW()`,
  );
  return Number(rows[0].n);
}

module.exports = { sincronizarPNCP, contarCacheAtivo };
