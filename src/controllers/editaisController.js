const axios = require('axios');

const PNCP_BASE_URL = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/consulta/v1';
const PNCP_PORTAL_URL = 'https://pncp.gov.br/app/editais';

// Códigos numéricos do PNCP para cada modalidade de contratação
const MODALIDADES = {
  'pregao eletronico': 6,
  'pregão eletrônico': 6,
  'pregao presencial': 7,
  'pregão presencial': 7,
  'concorrencia eletronica': 4,
  'concorrência eletrônica': 4,
  'concorrencia presencial': 5,
  'concorrência presencial': 5,
  'concorrencia': 4,
  'concorrência': 4,
  'dispensa': 8,
  'dispensa de licitacao': 8,
  'dispensa de licitação': 8,
  'inexigibilidade': 9,
  'leilao eletronico': 1,
  'leilão eletrônico': 1,
  'leilao presencial': 13,
  'leilão presencial': 13,
  'leilao': 1,
  'leilão': 1,
  'dialogo competitivo': 2,
  'diálogo competitivo': 2,
  'concurso': 3,
  'credenciamento': 12,
  'manifestacao de interesse': 10,
  'manifestação de interesse': 10,
  'pre-qualificacao': 11,
  'pré-qualificação': 11,
};

function formatarMoeda(valor) {
  if (valor == null) return null;
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(dataISO) {
  if (!dataISO) return null;
  return new Date(dataISO).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// Remove acentos para comparação tolerante na busca por palavra-chave
function semAcento(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function montarLink(cnpj, ano, sequencial) {
  return `${PNCP_PORTAL_URL}/${cnpj}/${ano}/${sequencial}`;
}

function formatarEdital(item) {
  const cnpj = item.orgaoEntidade?.cnpj;
  const ano = item.anoCompra;
  const sequencial = item.sequencialCompra;

  // ufNome e municipioNome migraram para dentro de unidadeOrgao na API do PNCP
  const unidade = item.unidadeOrgao ?? {};

  return {
    numeroEdital: item.numeroControlePNCP ?? null,
    orgao: item.orgaoEntidade?.razaoSocial ?? null,
    objeto: item.objetoCompra ?? null,
    valorEstimado: formatarMoeda(item.valorTotalEstimado),
    dataPublicacao: formatarData(item.dataPublicacaoPncp),
    dataEncerramentoProposta: formatarData(item.dataEncerramentoProposta),
    modalidade: item.modalidadeNome ?? null,
    estado: unidade.ufNome ?? null,
    municipio: unidade.municipioNome ?? null,
    link: cnpj && ano && sequencial ? montarLink(cnpj, ano, sequencial) : null,
  };
}

// Filtra localmente pelo termo buscado no objeto da licitação e no nome do órgão
function filtrarPorPalavraChave(dados, q) {
  const termo = semAcento(q);
  return dados.filter((item) => {
    const objeto = semAcento(item.objetoCompra ?? '');
    const orgao = semAcento(item.orgaoEntidade?.razaoSocial ?? '');
    return objeto.includes(termo) || orgao.includes(termo);
  });
}

// GET /editais
// Parâmetros: dataInicial*, dataFinal*, q, uf, modalidade, pagina, tamanhoPagina
async function listarEditais(req, res) {
  const {
    dataInicial,
    dataFinal,
    pagina = 1,
    tamanhoPagina = 10,
    q,
    uf,
    modalidade,
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
        erro: `Modalidade "${modalidade}" não reconhecida. Exemplos válidos: pregão eletrônico, concorrência, dispensa de licitação, inexigibilidade`,
      });
    }
  }

  const tamanhoSolicitado = Math.max(Number(tamanhoPagina), 10);
  const paginaSolicitada = Math.max(Number(pagina), 1);
  const filtraLocal = !!(q || uf);

  try {
    if (!filtraLocal) {
      // Sem filtros locais: delega paginação direto ao PNCP — acesso a todos os 28k+ registros
      const resposta = await axios.get(`${PNCP_BASE_URL}/contratacoes/proposta`, {
        params: {
          dataInicial,
          dataFinal,
          pagina: paginaSolicitada,
          tamanhoPagina: tamanhoSolicitado,
          ...(codigoModalidade && { codigoModalidadeContratacao: codigoModalidade }),
        },
        timeout: 10000,
      });

      const dados = resposta.data.data ?? [];
      if (dados.length === 0) {
        return res.json({
          mensagem: 'Nenhum edital encontrado para os filtros informados.',
          total: 0, pagina: paginaSolicitada, tamanhoPagina: tamanhoSolicitado, dados: [],
        });
      }
      return res.json({
        total: resposta.data.totalRegistros ?? dados.length,
        pagina: paginaSolicitada,
        tamanhoPagina: tamanhoSolicitado,
        dados: dados.map(formatarEdital),
      });
    }

    // Com filtros locais (q e/ou uf): varre até 10 páginas de 50 para cobrir dataset amplo
    const PAGINAS_BUSCA = 10;
    const paginas = await Promise.all(
      Array.from({ length: PAGINAS_BUSCA }, (_, i) =>
        axios.get(`${PNCP_BASE_URL}/contratacoes/proposta`, {
          params: {
            dataInicial,
            dataFinal,
            pagina: i + 1,
            tamanhoPagina: 50,
            ...(codigoModalidade && { codigoModalidadeContratacao: codigoModalidade }),
          },
          timeout: 12000,
        }).then((r) => r.data.data ?? []).catch(() => []),
      ),
    );

    let dados = paginas.flat();

    if (q) dados = filtrarPorPalavraChave(dados, q);
    if (uf) {
      const ufUpper = uf.toUpperCase();
      dados = dados.filter((item) =>
        (item.unidadeOrgao?.ufSigla ?? '').toUpperCase() === ufUpper,
      );
    }

    // Deduplica por numeroControlePNCP
    const vistos = new Set();
    dados = dados.filter((item) => {
      if (vistos.has(item.numeroControlePNCP)) return false;
      vistos.add(item.numeroControlePNCP);
      return true;
    });

    if (dados.length === 0) {
      return res.json({
        mensagem: 'Nenhum edital encontrado para os filtros informados.',
        total: 0, pagina: paginaSolicitada, tamanhoPagina: tamanhoSolicitado, dados: [],
      });
    }

    const inicio = (paginaSolicitada - 1) * tamanhoSolicitado;
    return res.json({
      total: dados.length,
      pagina: paginaSolicitada,
      tamanhoPagina: tamanhoSolicitado,
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

  try {
    const resposta = await axios.get(
      `${PNCP_BASE_URL}/orgaos/${cnpj}/compras/${ano}/${sequencial}`,
      { timeout: 10000 },
    );

    return res.json(formatarEdital(resposta.data));
  } catch (erro) {
    if (erro.response?.status === 404) {
      return res.status(404).json({
        mensagem: `Edital não encontrado: CNPJ ${cnpj}, ano ${ano}, sequencial ${sequencial}.`,
      });
    }
    const status = erro.response?.status ?? 502;
    const mensagem = erro.response?.data ?? 'Erro ao consultar o PNCP';
    return res.status(status).json({ erro: mensagem });
  }
}

module.exports = { listarEditais, buscarEditalPorId };
