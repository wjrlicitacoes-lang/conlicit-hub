const https = require('https');
const axios = require('axios');
const db = require('../database/db');
const { contarCacheAtivo } = require('../services/pncpSyncService');

const PNCP_BASE_URL   = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/consulta/v1';
const PNCP_V1_URL     = process.env.PNCP_BASE_URL_V1 || 'https://pncp.gov.br/api/pncp/v1';
const PNCP_PORTAL_URL = 'https://pncp.gov.br/app/editais';

// O PNCP usa certificado ICP-Brasil não reconhecido pelo bundle padrão do Node.js
const pncpAgent = new https.Agent({ rejectUnauthorized: false });

const MODALIDADES = {
  'pregao eletronico': 6, 'pregão eletrônico': 6,
  'pregao presencial': 7, 'pregão presencial': 7,
  'concorrencia eletronica': 4, 'concorrência eletrônica': 4,
  'concorrencia presencial': 5, 'concorrência presencial': 5,
  'concorrencia': 4, 'concorrência': 4,
  'dispensa': 8, 'dispensa de licitacao': 8, 'dispensa de licitação': 8,
  'dispensa eletronica': 8, 'dispensa eletrônica': 8,
  'inexigibilidade': 9,
  'leilao eletronico': 1, 'leilão eletrônico': 1,
  'leilao presencial': 13, 'leilão presencial': 13,
  'leilao': 1, 'leilão': 1,
  'dialogo competitivo': 2, 'diálogo competitivo': 2,
  'concurso': 3, 'credenciamento': 12,
  'manifestacao de interesse': 10, 'manifestação de interesse': 10,
  'pre-qualificacao': 11, 'pré-qualificação': 11,
};

function detectarPortal(link) {
  if (!link) return null;
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    if (host.includes('pncp.gov.br'))        return 'PNCP';
    if (host.includes('comprasnet.gov.br'))   return 'ComprasNet';
    if (host.includes('bec.sp.gov.br'))       return 'BEC/SP';
    if (host.includes('licitacoes-e.com.br')) return 'Licitações-e';
    if (host.includes('comprasbr.gov.br'))    return 'ComprasBR';
    if (host.includes('bbmnet.com.br'))       return 'BBMNet';
    if (host.includes('banrisul.com.br'))     return 'Banrisul';
    if (host.includes('caixa.gov.br'))        return 'Caixa';
    if (host.includes('gov.br'))             return 'Gov.br';
    return host;
  } catch {
    return null;
  }
}

function formatarMoeda(valor) {
  if (valor == null) return null;
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(d) {
  if (!d) return null;
  // Date object de coluna DATE do pg = midnight UTC → usar partes UTC diretamente
  if (d instanceof Date) {
    const dia = String(d.getUTCDate()).padStart(2, '0');
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dia}/${mes}/${d.getUTCFullYear()}`;
  }
  // String date-only "YYYY-MM-DD" → parse direto, sem conversão de fuso
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
    const [ano, mes, dia] = String(d).split('-');
    return `${dia}/${mes}/${ano}`;
  }
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function semAcento(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function sanitizarBusca(q) {
  return q
    .replace(/["""''()\[\]{}&+|:;!?@#$%^*=<>\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Converte qualquer formato de data para YYYY-MM-DD
function normalizarData(dataStr) {
  if (!dataStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dataStr)) return dataStr.substring(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(dataStr)) {
    const [dia, mes, ano] = dataStr.split('/');
    return `${ano}-${mes}-${dia}`;
  }
  if (/^\d{8}$/.test(dataStr)) {
    return `${dataStr.slice(0,4)}-${dataStr.slice(4,6)}-${dataStr.slice(6,8)}`;
  }
  return null;
}

// Formata item do endpoint REST PNCP para o padrão Hub
function formatarEditalSearch(item) {
  // ── Orçamento sigiloso ─────────────────────────────────────────────────────
  const orcamentoSigiloso = !!(item.orcamentoSigiloso ?? item.orcamento_sigiloso ?? false);

  // ── Valor estimado (campo confirmado do PNCP: valorTotalEstimadoDaCompra) ───
  const valorRaw = item.valorTotalEstimadoDaCompra
    ?? item.valorTotalEstimado
    ?? item.valor_total_estimado_da_compra
    ?? item.valor_total_estimado
    ?? item.valorGlobal
    ?? item.valor_global
    ?? item.valorEstimado
    ?? item.valor_estimado
    ?? item.valor
    ?? item.precoUnitario
    ?? null;
  const valorNumerico = (() => {
    if (valorRaw === null || valorRaw === undefined) return null;
    if (orcamentoSigiloso) return null;
    const n = parseFloat(String(valorRaw).replace(',', '.'));
    return (!isNaN(n) && n > 0) ? n : null;
  })();

  // ── Data de encerramento (camelCase e snake_case) ──────────────────────────
  const dataEncerramentoRaw = item.dataEncerramentoProposta
    ?? item.data_encerramento_proposta
    ?? item.dataFimRecebimentoProposta
    ?? item.data_fim_recebimento_proposta
    ?? item.dataEncerramento
    ?? item.data_encerramento
    ?? item.data_fim_vigencia
    ?? null;

  let dataEncerramentoFormatada = null;
  let horarioEncerramento = '';
  let labelSessao = '—';
  let diasRestantes = null;
  let dataEncerramentoFinal = dataEncerramentoRaw || null;

  if (dataEncerramentoRaw) {
    try {
      const iso = String(dataEncerramentoRaw).substring(0, 19); // "2026-06-11T08:00:00"
      const [datePart, timePart] = iso.split('T');
      const [ano, mes, dia] = datePart.split('-');
      dataEncerramentoFormatada = `${dia}/${mes}/${ano}`;
      if (timePart && timePart !== '00:00:00' && timePart !== '00:00') {
        const [hora, minuto] = timePart.split(':');
        horarioEncerramento = `${hora}:${minuto}`;
      } else {
        horarioEncerramento = '';
      }

      const dtEnc = new Date(Number(ano), Number(mes) - 1, Number(dia));
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      diasRestantes = Math.ceil((dtEnc - hoje) / (1000 * 60 * 60 * 24));

      if      (diasRestantes < 0)  labelSessao = 'Encerrado';
      else if (diasRestantes === 0) labelSessao = 'Encerra hoje';
      else if (diasRestantes === 1) labelSessao = 'Encerra amanhã';
      else                          labelSessao = `${diasRestantes}d restantes`;
    } catch (_) { /* mantém valores padrão */ }
  }

  // Se PNCP informou situação ativa, não marcar como 'Encerrado' com base apenas na data
  if (labelSessao === 'Encerrado') {
    const sit = (item.situacaoCompraNome ?? '').toLowerCase();
    const pncpDizAtivo = sit && !sit.includes('encerrad') && !sit.includes('cancelad') && !sit.includes('anulad') && !sit.includes('revogad') && !sit.includes('fracassad');
    if (pncpDizAtivo) {
      labelSessao          = '—';
      diasRestantes        = null;
      dataEncerramentoFinal = null; // evita recálculo de 'Encerrado' no frontend
    }
  }

  // ── Número do edital ───────────────────────────────────────────────────────
  const numero = item.numeroCompra
    ?? item.numero
    ?? item.codigoFormatado
    ?? item.numeroControlePNCP
    ?? item.numero_controle_pncp
    ?? '';

  // ── Órgão ──────────────────────────────────────────────────────────────────
  const orgao = item.orgaoEntidade?.razaoSocial
    ?? item.unidadeOrgao?.nomeUnidade
    ?? item.orgao?.nome
    ?? item.orgaoNome
    ?? item.orgao_nome
    ?? '';

  // ── Município + UF ─────────────────────────────────────────────────────────
  const municipio = item.unidadeOrgao?.municipioNome ?? item.municipioNome ?? item.municipio_nome ?? '';
  const uf        = item.unidadeOrgao?.ufSigla ?? item.unidadeOrgao?.ufNome ?? item.ufSigla ?? item.uf ?? '';
  const local     = [municipio, uf].filter(Boolean).join(' · ') || '';

  // ── Modalidade ─────────────────────────────────────────────────────────────
  const modalidade = item.modalidadeNome ?? item.modalidade ?? item.modalidade_licitacao_nome ?? '';

  // ── Link ───────────────────────────────────────────────────────────────────
  const cnpj = item.orgaoEntidade?.cnpj ?? item.orgao_cnpj ?? null;
  const ano  = item.anoCompra ?? item.ano ?? null;
  const seq  = item.sequencialCompra ?? item.numero_sequencial ?? null;
  const linkMontado = cnpj && ano && seq ? montarLink(cnpj, ano, seq) : null;
  const linkPNCP = item.linkSistemaOrigem
    ?? item.link_sistema_origem
    ?? item.link
    ?? linkMontado
    ?? (numero ? `https://pncp.gov.br/app/editais/${numero}` : null);

  // ── Plataforma ─────────────────────────────────────────────────────────────
  const plataforma = item.sistemaOrigem ?? item.plataforma ?? 'PNCP';

  // ── Objeto ─────────────────────────────────────────────────────────────────
  const descRaw = item.descricaoObjeto
    ?? item.objeto
    ?? item.objetoCompra
    ?? item.titulo
    ?? item.description
    ?? item.title
    ?? '';
  const objeto = descRaw.replace(/^\[[^\]]+\]\s*-\s*/, '').trim() || null;

  return {
    // Compatibilidade com renderCard existente
    numeroEdital:             numero || item.numeroControlePNCP || item.numero_controle_pncp || null,
    numero,
    orgao:                    orgao || null,
    objeto,
    // valorEstimado: número, 'Sigiloso' se orçamento sigiloso sem valor, ou null
    valorEstimado:            orcamentoSigiloso ? 'Sigiloso' : valorNumerico,
    valor_str:                valorNumerico
      ? `R$ ${valorNumerico.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : (orcamentoSigiloso ? 'Sigiloso' : '—'),
    orcamento_sigiloso:       orcamentoSigiloso,
    dataPublicacao:           null,
    // Não formatar como DD/MM/YYYY — causaria new Date() inválido no frontend
    dataEncerramentoProposta: null,
    // ISO raw para comparação e display via toLocaleString
    dataEncerramento:         dataEncerramentoFinal,
    modalidade:               modalidade || null,
    estado:                   uf || null,
    uf:                       uf || null,
    municipio:                municipio || null,
    local:                    local || null,
    link:                     linkPNCP,
    linkSistemaOrigem:        linkPNCP,
    dataAberturaProposta:     null,
    portal_disputa:           plataforma,
    // Campos pré-computados para o badge (evitam NaN no frontend)
    labelSessao,
    diasRestantes,
    horarioEncerramento,
    dataEncerramentoFormatada,
    status:                   item.situacaoCompraNome ?? 'Recebendo propostas',
  };
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
    valorEstimado:            formatarMoeda(
      item.valorTotalEstimadoDaCompra
      ?? item.valorTotalEstimado
      ?? item.valor_total_estimado_da_compra
      ?? item.valor_estimado
      ?? null
    ),
    dataPublicacao:           formatarData(item.dataPublicacaoPncp ?? item.data_publicacao),
    dataEncerramentoProposta: formatarData(item.dataEncerramentoProposta ?? item.data_encerramento),
    modalidade:               item.modalidadeNome ?? item.modalidade_nome ?? null,
    estado:                   u.ufNome ?? null,
    municipio:                u.municipioNome ?? item.municipio ?? null,
    link:                     cnpj && ano && seq ? montarLink(cnpj, ano, seq) : null,
    linkSistemaOrigem:        item.linkSistemaOrigem ?? raw.linkSistemaOrigem ?? null,
    // dataEncerramento: ISO seguro — DATE do BD vira noon BRT (evita rollback para 21h)
    dataEncerramento: (() => {
      const rawVal = item.dataEncerramentoProposta ?? item.data_encerramento;
      if (!rawVal) return null;
      if (rawVal instanceof Date) {
        const y = rawVal.getUTCFullYear();
        const m = String(rawVal.getUTCMonth() + 1).padStart(2, '0');
        const d = String(rawVal.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}T12:00:00-03:00`;
      }
      const s = String(rawVal);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00-03:00`;
      return s;
    })(),
    dataAberturaProposta:     item.dataAberturaProposta ?? raw.dataAberturaProposta ?? null,
    portal_disputa:           detectarPortal(item.linkSistemaOrigem ?? raw.linkSistemaOrigem ?? null),
  };
}

// ── Busca no cache local (PostgreSQL FTS) ──
async function buscarNaCache({ q, uf, modalidade, modalidades, dataInicial, dataFinal, cidade, raio_km, portal, portais, valorMin, valorMax, pagina, tamanhoPagina }) {
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
    const ufs = uf.split(',').map(u => u.trim().toUpperCase()).filter(Boolean);
    if (ufs.length === 1) {
      condicoes.push(`uf = $${idx++}`);
      params.push(ufs[0]);
    } else if (ufs.length > 1) {
      const placeholders = ufs.map(() => `$${idx++}`).join(',');
      condicoes.push(`uf IN (${placeholders})`);
      ufs.forEach(u => params.push(u));
    }
  }

  // Multi-modalidade (array) tem prioridade sobre modalidade singular
  if (modalidades && modalidades.length > 0) {
    const placeholders = modalidades.map(() => `$${idx++}`).join(',');
    condicoes.push(`modalidade_nome ILIKE ANY(ARRAY[${placeholders}])`);
    modalidades.forEach(m => params.push(`%${m}%`));
  } else if (modalidade) {
    condicoes.push(`modalidade_nome ILIKE $${idx++}`);
    params.push(`%${modalidade}%`);
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

  if (valorMin != null && !isNaN(valorMin)) {
    condicoes.push(`valor_estimado >= $${idx++}`);
    params.push(Number(valorMin));
  }

  if (valorMax != null && !isNaN(valorMax)) {
    condicoes.push(`valor_estimado <= $${idx++}`);
    params.push(Number(valorMax));
  }

  // Mapa de nome de portal → padrão de URL para filtrar no campo raw
  const PORTAL_URL_MAP = {
    'licitar digital':              '%licitardigital%',
    'compras.gov':                  '%comprasnet.gov.br%',
    'portal mg':                    '%mg.gov.br%',
    'bll compras':                  '%bll%',
    'bbmnet':                       '%bbmnet%',
    'portal de compras públicas':   '%portaldecompraspublicas%',
    'pcp':                          '%portaldecompraspublicas%',
    'sigmix':                       '%sigmix%',
    'licitações-e':                 '%licitacoes-e%',
    // valores legados (single-select antigo)
    pncp:           '%pncp.gov.br%',
    comprasnet:     '%comprasnet.gov.br%',
    'bec/sp':       '%bec.sp.gov.br%',
    'licitacoes-e': '%licitacoes-e.com.br%',
    comprasbr:      '%comprasbr.gov.br%',
    bbmnet:         '%bbmnet.com.br%',
    banrisul:       '%banrisul.com.br%',
    caixa:          '%caixa.gov.br%',
  };

  // Multi-portal (array) tem prioridade sobre portal singular
  if (portais && portais.length > 0) {
    const patterns = portais.map(p => PORTAL_URL_MAP[p.toLowerCase()]).filter(Boolean);
    if (patterns.length > 0) {
      const placeholders = patterns.map(() => `$${idx++}`).join(',');
      condicoes.push(`raw->>'linkSistemaOrigem' ILIKE ANY(ARRAY[${placeholders}])`);
      patterns.forEach(p => params.push(p));
    }
  } else if (portal) {
    const pattern = PORTAL_URL_MAP[portal.toLowerCase()];
    if (pattern) {
      condicoes.push(`raw->>'linkSistemaOrigem' ILIKE $${idx++}`);
      params.push(pattern);
    }
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
  const { q, uf, dataFinal, modalidade, portal, valorMin, valorMax, pagina = 1, tamanhoPagina = 10 } = req.query;

  // Datas em YYYYMMDD — formato exigido pela API /consulta/v1
  const hoje    = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dataIni = hoje;
  const dataFim = dataFinal
    ? String(dataFinal).replace(/-/g, '')
    : (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10).replace(/-/g, ''); })();
  const pg  = Math.max(Number(pagina), 1);
  const tam = Math.max(Number(tamanhoPagina), 10);

  try {
    const paginas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        axios.get(`${PNCP_BASE_URL}/contratacoes/proposta`, {
          params: {
            dataInicial:   dataIni,
            dataFinal:     dataFim,
            tamanhoPagina: 20,
            pagina:        i + 1,
            ...(uf && uf !== 'todos' ? { uf: uf.toUpperCase() } : {}),
          },
          headers: { Accept: 'application/json', 'User-Agent': 'ConlicitHub/1.0' },
          httpsAgent: pncpAgent,
          timeout: 15000,
        })
        .then(r => r.data?.data ?? [])
        .catch(() => [])
      )
    );

    let dados = paginas.flat();

    const vistos = new Set();
    dados = dados.filter(item => {
      const key = item.numeroControlePNCP;
      if (!key || vistos.has(key)) return false;
      vistos.add(key);
      return true;
    });

    if (q) {
      const qLow = q.toLowerCase();
      dados = dados.filter(item =>
        (item.descricaoObjeto ?? item.objetoCompra ?? '').toLowerCase().includes(qLow)
      );
    }

    if (modalidade) {
      const modLow = modalidade.toLowerCase();
      dados = dados.filter(item => (item.modalidadeNome ?? '').toLowerCase().includes(modLow));
    }
    if (portal) {
      const portalLow = portal.toLowerCase();
      dados = dados.filter(item => (item.linkSistemaOrigem ?? '').toLowerCase().includes(portalLow));
    }
    if (valorMin != null && valorMin !== '') {
      const vMin = Number(valorMin);
      dados = dados.filter(item => Number(item.valorTotalEstimadoDaCompra ?? 0) >= vMin);
    }
    if (valorMax != null && valorMax !== '') {
      const vMax = Number(valorMax);
      dados = dados.filter(item => Number(item.valorTotalEstimadoDaCompra ?? 0) <= vMax);
    }

    dados.sort((a, b) => {
      const dA = a.dataEncerramentoProposta ?? '';
      const dB = b.dataEncerramentoProposta ?? '';
      if (!dA && !dB) return 0; if (!dA) return 1; if (!dB) return -1;
      return new Date(dA) - new Date(dB);
    });

    const inicio = (pg - 1) * tam;
    return res.json({
      total: dados.length, pagina: pg, tamanhoPagina: tam, fonte: 'pncp-consulta',
      dados: dados.slice(inicio, inicio + tam).map(formatarEditalSearch),
    });
  } catch (err) {
    return res.status(502).json({ erro: 'Erro ao consultar o PNCP: ' + err.message });
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
      { httpsAgent: pncpAgent, timeout: 10000 },
    );
    return res.json(formatarEdital(resposta.data));
  } catch (erro) {
    if (erro.response?.status === 404) {
      return res.status(404).json({ mensagem: `Edital não encontrado: CNPJ ${cnpj}, ano ${ano}, sequencial ${sequencial}.` });
    }
    return res.status(erro.response?.status ?? 502).json({ erro: erro.response?.data ?? 'Erro ao consultar o PNCP' });
  }
}

// GET /editais/:cnpj/:ano/:sequencial/itens
async function buscarItensPorEdital(req, res) {
  const { cnpj, ano, sequencial } = req.params;
  try {
    const resposta = await axios.get(
      `${PNCP_V1_URL}/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens`,
      { httpsAgent: pncpAgent, timeout: 10000 },
    );
    const itens = Array.isArray(resposta.data) ? resposta.data : (resposta.data?.data ?? []);
    return res.json({ itens, total: itens.length, fonte: 'PNCP' });
  } catch (erro) {
    if (erro.response?.status === 404) {
      return res.json({ itens: [], total: 0, fonte: 'PNCP' });
    }
    return res.status(erro.response?.status ?? 502).json({ erro: erro.response?.data ?? 'Erro ao consultar itens no PNCP' });
  }
}

module.exports = { listarEditais, buscarEditalPorId, buscarItensPorEdital };
