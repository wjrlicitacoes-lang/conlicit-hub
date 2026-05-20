const axios = require('axios');
const db = require('../database/db');
const { contarCacheAtivo } = require('../services/pncpSyncService');

const PNCP_BASE_URL = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/consulta/v1';
const PNCP_PORTAL_URL = 'https://pncp.gov.br/app/editais';

const MODALIDADES = {
  'pregao eletronico': 6, 'pregão eletrônico': 6,
  'pregao presencial': 7, 'pregão presencial': 7,
  'concorrencia eletronica': 4, 'concorrência eletrônica': 4,
  'concorrencia presencial': 5, 'concorrência presencial': 5,
  'concorrencia': 4, 'concorrência': 4,
  'dispensa': 8, 'dispensa de licitacao': 8, 'dispensa de licitação': 8,
  'inexigibilidade': 9,
  'leilao eletronico': 1, 'leilão eletrônico': 1,
  'leilao presencial': 13, 'leilão presencial': 13,
  'leilao': 1, 'leilão': 1,
  'dialogo competitivo': 2, 'diálogo competitivo': 2,
  'concurso': 3, 'credenciamento': 12,
  'manifestacao de interesse': 10, 'manifestação de interesse': 10,
  'pre-qualificacao': 11, 'pré-qualificação': 11,
};

function formatarMoeda(valor) {
  if (valor == null) return null;
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function semAcento(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function montarLink(cnpj, ano, sequencial) {
  return `${PNCP_PORTAL_URL}/${cnpj}/${ano}/${sequencial}`;
}

function formatarEdital(item) {
  const cnpj = item.orgaoEntidade?.cnpj ?? item.orgao_cnpj;
  const ano  = item.anoCompra      ?? item.ano_compra;
  const seq  = item.sequencialCompra ?? item.sequencial_compra;
  const u    = item.unidadeOrgao ?? {};
  const raw  = item.raw ?? item;
  return {
    numeroEdital:             item.numeroControlePNCP ?? item.numero_controle_pncp ?? null,
    orgao:                    item.orgaoEntidade?.razaoSocial ?? item.orgao_nome ?? null,
    objeto:                   item.objetoCompra ?? item.objeto ?? null,
    valorEstimado:            formatarMoeda(item.valorTotalEstimado ?? item.valor_estimado),
    dataPublicacao:           formatarData(item.dataPublicacaoPncp ?? item.data_publicacao),
    dataEncerramentoProposta: formatarData(item.dataEncerramentoProposta ?? item.data_encerramento),
    modalidade:               item.modalidadeNome ?? item.modalidade_nome ?? null,
    estado:                   u.ufNome ?? null,
    municipio:                u.municipioNome ?? item.municipio ?? null,
    link:                     cnpj && ano && seq ? montarLink(cnpj, ano, seq) : null,
    linkSistemaOrigem:        item.linkSistemaOrigem ?? raw.linkSistemaOrigem ?? null,
    dataEncerramento:         item.dataEncerramentoProposta ?? item.data_encerramento ?? null,
  };
}

// ── Busca no cache local (PostgreSQL FTS) ──
async function buscarNaCache({ q, uf, modalidade, dataInicial, dataFinal, cidade, raio_km, pagina, tamanhoPagina }) {
  const condicoes = [`data_encerramento >= NOW()`];
  const params = [];
  let idx = 1;

  if (q) {
    // plainto_tsquery é tolerante: ignora operadores, trata cada palavra como AND
    condicoes.push(
      `to_tsvector('portuguese', coalesce(objeto,'') || ' ' || coalesce(orgao_nome,''))
       @@ plainto_tsquery('portuguese', $${idx++})`,
    );
    params.push(q);
  }

  if (uf) {
    condicoes.push(`uf = $${idx++}`);
    params.push(uf.toUpperCase());
  }

  if (modalidade) {
    const codigo = MODALIDADES[modalidade.toLowerCase().trim()];
    if (codigo) {
      // modalidade_nome contém o texto, não o código
      condicoes.push(`modalidade_nome ILIKE $${idx++}`);
      params.push(`%${modalidade}%`);
    }
  }

  if (dataInicial) {
    condicoes.push(`data_encerramento >= $${idx++}`);
    params.push(dataInicial.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  }

  if (dataFinal) {
    condicoes.push(`data_encerramento <= $${idx++}`);
    params.push(dataFinal.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  }

  // TODO: implementar geolocalização real via API IBGE de vizinhos
  // Opção B (prática): cidade exata ≤50 km; estado inteiro ≤150 km; sem filtro >150 km
  if (cidade) {
    const raio = parseInt(raio_km) || 0;
    if (raio <= 50) {
      condicoes.push(`municipio ILIKE $${idx++}`);
      params.push(`%${cidade}%`);
    } else if (raio <= 150) {
      const ufResult = await db.query(
        'SELECT uf FROM editais_cache WHERE municipio ILIKE $1 AND uf IS NOT NULL LIMIT 1',
        [`%${cidade}%`],
      );
      if (ufResult.rows.length > 0) {
        condicoes.push(`uf = $${idx++}`);
        params.push(ufResult.rows[0].uf);
      } else {
        // cidade não encontrada no cache — fallback para busca por nome
        condicoes.push(`municipio ILIKE $${idx++}`);
        params.push(`%${cidade}%`);
      }
    }
    // raio > 150 = sem filtro de localização (nacional)
  }

  const where = condicoes.join(' AND ');

  const { rows: [{ n }] } = await db.query(
    `SELECT COUNT(*) AS n FROM editais_cache WHERE ${where}`, params,
  );
  const total = Number(n);

  const offset = (pagina - 1) * tamanhoPagina;
  const { rows } = await db.query(
    `SELECT *, raw
     FROM editais_cache
     WHERE ${where}
     ORDER BY data_encerramento ASC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, tamanhoPagina, offset],
  );

  return { total, dados: rows };
}

// GET /editais
async function listarEditais(req, res) {
  const {
    dataInicial,
    dataFinal,
    pagina        = 1,
    tamanhoPagina = 10,
    q,
    uf,
    modalidade,
    cidade,
    raio_km,
  } = req.query;

  if (!dataInicial || !dataFinal) {
    return res.status(400).json({
      erro: 'Os parâmetros dataInicial e dataFinal são obrigatórios (formato: YYYYMMDD)',
    });
  }

  let codigoModalidade;
  if (modalidade) {
    codigoModalidade = MODALIDADES[modalidade.toLowerCase().trim()];
    if (!codigoModalidade) {
      return res.status(400).json({
        erro: `Modalidade "${modalidade}" não reconhecida. Exemplos válidos: pregão eletrônico, concorrência, dispensa de licitação`,
      });
    }
  }

  const tamanhoSolicitado = Math.max(Number(tamanhoPagina), 10);
  const paginaSolicitada  = Math.max(Number(pagina), 1);
  const filtraLocal       = !!(q || uf || cidade);

  try {
    // ── Sem filtros locais: delega direto ao PNCP (acesso completo a 28k+ registros) ──
    if (!filtraLocal) {
      const resposta = await axios.get(`${PNCP_BASE_URL}/contratacoes/proposta`, {
        params: {
          dataInicial,
          dataFinal,
          pagina: paginaSolicitada,
          tamanhoPagina: tamanhoSolicitado,
          ...(codigoModalidade && { codigoModalidadeContratacao: codigoModalidade }),
        },
        timeout: 15000,
      });

      const dados = resposta.data.data ?? [];
      if (dados.length === 0) {
        return res.json({ mensagem: 'Nenhum edital encontrado.', total: 0, pagina: paginaSolicitada, tamanhoPagina: tamanhoSolicitado, dados: [] });
      }
      return res.json({
        total: resposta.data.totalRegistros ?? dados.length,
        pagina: paginaSolicitada,
        tamanhoPagina: tamanhoSolicitado,
        fonte: 'pncp-direto',
        dados: dados.map(formatarEdital),
      });
    }

    // ── Com filtros locais: tenta o cache primeiro ──
    const totalCache = await contarCacheAtivo();

    if (totalCache >= 100) {
      // Cache populado → busca no banco (cobertura 100% dos editais sincronizados)
      const { total, dados } = await buscarNaCache({
        q, uf, modalidade, dataInicial, dataFinal, cidade, raio_km,
        pagina: paginaSolicitada, tamanhoPagina: tamanhoSolicitado,
      });

      if (total === 0) {
        return res.json({ mensagem: 'Nenhum edital encontrado para os filtros informados.', total: 0, pagina: paginaSolicitada, tamanhoPagina: tamanhoSolicitado, dados: [] });
      }

      return res.json({
        total,
        pagina: paginaSolicitada,
        tamanhoPagina: tamanhoSolicitado,
        fonte: `cache-local (${totalCache.toLocaleString('pt-BR')} editais indexados)`,
        dados: dados.map((row) => {
          // row vem do banco; raw é JSONB com o item original do PNCP
          const raw = row.raw ?? {};
          return formatarEdital({
            ...raw,
            orgao_cnpj:           row.orgao_cnpj,
            orgao_nome:           row.orgao_nome,
            objeto:               row.objeto,
            valor_estimado:       row.valor_estimado,
            data_publicacao:      row.data_publicacao,
            data_encerramento:    row.data_encerramento,
            municipio:            row.municipio,
            modalidade_nome:      row.modalidade_nome,
            numero_controle_pncp: row.numero_controle_pncp,
            ano_compra:           row.ano_compra,
            sequencial_compra:    row.sequencial_compra,
          });
        }),
      });
    }

    // ── Cache vazio → fallback: varre 50 páginas do PNCP em paralelo ──
    console.log(`[Editais] Cache vazio (${totalCache} itens) — varrendo PNCP (50 págs)...`);
    const PAGINAS_BUSCA = 50;
    const paginas = await Promise.all(
      Array.from({ length: PAGINAS_BUSCA }, (_, i) =>
        axios.get(`${PNCP_BASE_URL}/contratacoes/proposta`, {
          params: { dataInicial, dataFinal, pagina: i + 1, tamanhoPagina: 50,
            ...(codigoModalidade && { codigoModalidadeContratacao: codigoModalidade }) },
          timeout: 15000,
        }).then((r) => r.data.data ?? []).catch(() => []),
      ),
    );

    let dados = paginas.flat();

    if (q) {
      const termo = semAcento(q);
      dados = dados.filter((item) =>
        semAcento(item.objetoCompra ?? '').includes(termo) ||
        semAcento(item.orgaoEntidade?.razaoSocial ?? '').includes(termo),
      );
    }
    if (uf) {
      const ufUpper = uf.toUpperCase();
      dados = dados.filter((item) => (item.unidadeOrgao?.ufSigla ?? '').toUpperCase() === ufUpper);
    }

    if (cidade) {
      const cidadeLower = semAcento(cidade);
      dados = dados.filter((item) =>
        semAcento(item.unidadeOrgao?.municipioNome ?? '').includes(cidadeLower),
      );
    }

    const vistos = new Set();
    dados = dados.filter((item) => {
      if (vistos.has(item.numeroControlePNCP)) return false;
      vistos.add(item.numeroControlePNCP);
      return true;
    });

    if (dados.length === 0) {
      return res.json({
        mensagem: 'Nenhum edital encontrado. Dica: dispare a sincronização em POST /editais/sincronizar para indexar todos os editais do PNCP.',
        total: 0, pagina: paginaSolicitada, tamanhoPagina: tamanhoSolicitado, dados: [],
      });
    }

    const inicio = (paginaSolicitada - 1) * tamanhoSolicitado;
    return res.json({
      total: dados.length,
      pagina: paginaSolicitada,
      tamanhoPagina: tamanhoSolicitado,
      fonte: 'pncp-fallback-50pags',
      aviso: 'Cache não sincronizado. Rode POST /editais/sincronizar para cobertura completa.',
      dados: dados.slice(inicio, inicio + tamanhoSolicitado).map(formatarEdital),
    });

  } catch (erro) {
    const status = erro.response?.status ?? 502;
    const mensagem = erro.response?.data ?? 'Erro ao consultar o PNCP';
    return res.status(status).json({ erro: mensagem });
  }
}

// GET /editais/:cnpj/:ano/:sequencial
async function buscarEditalPorId(req, res) {
  const { cnpj, ano, sequencial } = req.params;

  // Tenta o cache primeiro
  const { rows } = await db.query(
    `SELECT * FROM editais_cache WHERE orgao_cnpj = $1 AND ano_compra = $2 AND sequencial_compra = $3`,
    [cnpj, Number(ano), Number(sequencial)],
  ).catch(() => ({ rows: [] }));

  if (rows.length > 0) {
    return res.json(formatarEdital(rows[0].raw ?? rows[0]));
  }

  try {
    const resposta = await axios.get(
      `${PNCP_BASE_URL}/orgaos/${cnpj}/compras/${ano}/${sequencial}`,
      { timeout: 10000 },
    );
    return res.json(formatarEdital(resposta.data));
  } catch (erro) {
    if (erro.response?.status === 404) {
      return res.status(404).json({ mensagem: `Edital não encontrado: CNPJ ${cnpj}, ano ${ano}, sequencial ${sequencial}.` });
    }
    return res.status(erro.response?.status ?? 502).json({ erro: erro.response?.data ?? 'Erro ao consultar o PNCP' });
  }
}

module.exports = { listarEditais, buscarEditalPorId };
