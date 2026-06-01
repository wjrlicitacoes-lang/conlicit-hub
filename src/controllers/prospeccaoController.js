// src/controllers/prospeccaoController.js
// Busca automática de leads via PNCP
// Encontra empresas que participaram de pregões e não venceram
// Salva automaticamente na tabela prospects

const axios = require('axios');
const db    = require('../database/db');

const PNCP_CONSULTA = 'https://pncp.gov.br/api/consulta/v1';
const PNCP_BASE     = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/pncp/v1';
const CNPJ_API      = 'https://publica.cnpj.ws/cnpj';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function limparCNPJ(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

function formatarCNPJ(cnpj) {
  const c = limparCNPJ(cnpj);
  if (c.length !== 14) return cnpj;
  return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}/${c.slice(8,12)}-${c.slice(12)}`;
}

// Mapeia palavras-chave de segmento para busca no PNCP
const SEGMENTOS = {
  'alimentacao':         ['gêneros alimentícios', 'alimentação escolar', 'merenda', 'alimentos'],
  'material_escritorio': ['material de escritório', 'papel A4', 'cartuchos', 'material escolar'],
  'limpeza':             ['material de limpeza', 'produtos de limpeza', 'higienização', 'limpeza'],
  'ti':                  ['computador', 'notebook', 'impressora', 'equipamentos de informática', 'TI'],
  'saude':               ['medicamentos', 'material hospitalar', 'EPI', 'equipamentos médicos'],
  'servicos_limpeza':    ['serviços de limpeza', 'limpeza predial', 'conservação e limpeza'],
  'vigilancia':          ['vigilância', 'segurança patrimonial', 'monitoramento'],
  'manutencao':          ['manutenção predial', 'reforma', 'serviços de manutenção'],
};

// ── Busca contratos assinados no PNCP (fornecedores vencedores) ───────────────
// Estratégia: usar /contratos que tem CNPJ real do fornecedor + objeto + UF

async function buscarContratosVencedores({ palavraChave, uf, cidade, tipo, diasAtras = 90, maxResultados = 60 }) {
  const hoje    = new Date();
  const dataFim = hoje.toISOString().slice(0, 10).replace(/-/g, '');
  const dataIni = new Date(hoje - diasAtras * 86400000).toISOString().slice(0, 10).replace(/-/g, '');

  const correspondentes = [];
  const TAMANHO_PAGINA  = 50;
  const MAX_PAGINAS     = 8;

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    if (correspondentes.length >= maxResultados) break;

    let resp;
    try {
      resp = await axios.get(`${PNCP_CONSULTA}/contratos`, {
        params: {
          dataInicial:   dataIni,
          dataFinal:     dataFim,
          pagina,
          tamanhoPagina: TAMANHO_PAGINA,
          ...(uf ? { uf: uf.toUpperCase() } : {}),
        },
        timeout: 15000,
      });
    } catch (e) {
      console.warn('[Prospecção] Falha ao buscar contratos PNCP página', pagina, ':', e.message);
      break;
    }

    const todos     = resp.data?.data ?? [];
    const totalPags = resp.data?.totalPaginas ?? 1;

    for (const c of todos) {
      if (c.tipoPessoa !== 'PJ') continue; // só pessoas jurídicas
      const cnpj = (c.niFornecedor || '').replace(/\D/g, '');
      if (cnpj.length !== 14) continue;

      const objeto   = (c.objetoContrato || '').toLowerCase();
      const ufP      = (c.unidadeOrgao?.ufSigla || '').toUpperCase();
      const cidadeP  = (c.unidadeOrgao?.municipioNome || '').toLowerCase();
      const catNome  = (c.categoriaProcesso?.nome || '').toLowerCase();

      const matchObj    = palavraChave ? objeto.includes(palavraChave.toLowerCase()) : true;
      const matchUF     = uf     ? ufP === uf.toUpperCase() : true;
      const matchCidade = cidade ? cidadeP.includes(cidade.toLowerCase()) : true;
      const matchTipo   = tipo
        ? (tipo === 'produto' ? catNome.includes('material') || catNome.includes('bem') || catNome.includes('fornecimento')
         : tipo === 'servico' ? catNome.includes('serviço')  || catNome.includes('servico')
         : true)
        : true;

      if (matchObj && matchUF && matchCidade && matchTipo) correspondentes.push(c);
    }

    if (pagina >= totalPags) break;
    await sleep(150);
  }

  return correspondentes;
}

// ── Enriquece empresa via CNPJ público ───────────────────────────────────────

async function enriquecerCNPJ(cnpj) {
  const cnpjLimpo = limparCNPJ(cnpj);
  if (cnpjLimpo.length !== 14) return null;

  try {
    await sleep(300);
    const { data } = await axios.get(`${CNPJ_API}/${cnpjLimpo}`, { timeout: 8000 });
    const socios = data.socios || [];
    const responsavel = socios.length > 0
      ? socios[0].nome_socio_pf || socios[0].nome_socio || null
      : null;
    const tel = data.ddd_telefone_1
      ? `(${data.ddd_telefone_1.slice(0, 2)}) ${data.ddd_telefone_1.slice(2)}`
      : null;

    return {
      razao_social:   data.razao_social   || null,
      nome_fantasia:  data.nome_fantasia  || null,
      responsavel,
      telefone:       tel,
      email:          data.email          || null,
      municipio:      data.municipio      || null,
      uf:             data.uf             || null,
      cnae_principal: data.cnae_fiscal_descricao || null,
      porte:          data.porte          || null,
    };
  } catch {
    return null;
  }
}

// ── Controller principal ──────────────────────────────────────────────────────

// GET /captacao/prospectar?segmento=alimentacao&palavra_chave=merenda&uf=SP&cidade=Campinas&tipo=produto&dias=60&limite=20&enriquecer=false
async function prospectar(req, res) {
  const {
    segmento    = 'alimentacao',
    palavra_chave,          // busca livre — substitui palavras do segmento se informado
    uf,
    cidade,                 // filtra por municipioNome da unidadeOrgao
    tipo,                   // 'produto' | 'servico' | vazio
    dias        = 90,
    limite      = 20,
    enriquecer  = 'true',
  } = req.query;

  // Se palavra_chave livre foi informada, usa ela sozinha; senão usa palavras do segmento
  const palavrasChave = palavra_chave
    ? [palavra_chave]
    : (SEGMENTOS[segmento] || [segmento]);

  const leadsEncontrados = [];
  const cnpjsProcessados = new Set();
  let contratosAnalisados = 0;

  try {
    for (const palavra of palavrasChave) {
      if (leadsEncontrados.length >= Number(limite)) break;

      const contratos = await buscarContratosVencedores({
        palavraChave:  palavra,
        uf,
        cidade,
        tipo,
        diasAtras:     Number(dias),
        maxResultados: Number(limite) * 3,
      });

      for (const contrato of contratos) {
        if (leadsEncontrados.length >= Number(limite)) break;

        const cnpjForn  = limparCNPJ(contrato.niFornecedor);
        if (!cnpjForn || cnpjForn.length !== 14) continue;
        if (cnpjsProcessados.has(cnpjForn)) continue;
        cnpjsProcessados.add(cnpjForn);
        contratosAnalisados++;

        const objeto    = contrato.objetoContrato || '';
        const valorCont = contrato.valorGlobal || contrato.valorInicial || 0;
        const municipio = contrato.unidadeOrgao?.municipioNome || null;
        const ufCont    = contrato.unidadeOrgao?.ufSigla || null;
        const numContrato = contrato.numeroControlePNCP || contrato.numeroContratoEmpenho || '—';

        let dadosCNPJ = null;
        if (enriquecer === 'true') dadosCNPJ = await enriquecerCNPJ(cnpjForn);

        const lead = {
          cnpj:          formatarCNPJ(cnpjForn),
          razao_social:  dadosCNPJ?.razao_social || contrato.nomeRazaoSocialFornecedor || null,
          nome_fantasia: dadosCNPJ?.nome_fantasia || null,
          responsavel:   dadosCNPJ?.responsavel   || null,
          telefone:      dadosCNPJ?.telefone       || null,
          email:         dadosCNPJ?.email          || null,
          municipio:     dadosCNPJ?.municipio      || municipio || null,
          uf:            dadosCNPJ?.uf             || ufCont    || uf || null,
          segmento:      palavra_chave ? (segmento || 'livre') : segmento,
          contrato_numero: numContrato,
          contrato_objeto: objeto,
          contrato_valor:  valorCont,
          contrato_data:   contrato.dataAssinatura || null,
          perfil: 'vencedor_licitacao',
          prioridade: valorCont >= 50000 ? 'Alta' : 'Média',
        };

        leadsEncontrados.push(lead);

        try {
          const nota = [
            `[Lead via Prospecção PNCP Contratos — ${new Date().toLocaleDateString('pt-BR')}]`,
            `Contrato: ${numContrato}`,
            `Objeto: ${objeto.slice(0, 150)}`,
            `Valor: R$ ${valorCont?.toLocaleString('pt-BR') || '—'}`,
            `Assinado em: ${contrato.dataAssinatura || '—'}`,
            municipio ? `Município do órgão: ${municipio}/${ufCont || ''}` : '',
            `Perfil: empresa vencedora de licitação — cliente potencial para o Hub`,
          ].filter(Boolean).join('\n');

          await db.query(
            `INSERT INTO prospects
               (nome, email, whatsapp, empresa, segmento, status, notas, responsavel)
             VALUES ($1, $2, $3, $4, $5, 'em_negociacao', $6, 'PNCP Auto')
             ON CONFLICT DO NOTHING`,
            [
              dadosCNPJ?.responsavel || lead.razao_social || 'A identificar',
              dadosCNPJ?.email    || null,
              dadosCNPJ?.telefone || null,
              lead.razao_social,
              lead.segmento,
              nota,
            ]
          );
        } catch (dbErr) {
          console.warn('[Prospecção] Falha ao salvar prospect:', dbErr.message);
        }
      }
    }

    return res.json({
      sucesso:              true,
      estrategia:           'contratos_assinados',
      segmento:             palavra_chave ? 'livre' : segmento,
      palavra_chave:        palavra_chave || null,
      uf:                   uf     || 'todos',
      cidade:               cidade || null,
      tipo:                 tipo   || null,
      dias_analisados:      Number(dias),
      contratos_analisados: contratosAnalisados,
      leads_encontrados:    leadsEncontrados.length,
      leads:                leadsEncontrados,
    });

  } catch (e) {
    console.error('[Prospecção] Erro:', e.message);
    return res.status(500).json({ erro: 'Erro ao prospectar. Tente novamente.' });
  }
}

// GET /captacao/segmentos
function listarSegmentos(req, res) {
  return res.json({
    segmentos: Object.keys(SEGMENTOS).map(k => ({
      id:           k,
      label:        k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      palavras_chave: SEGMENTOS[k],
    }))
  });
}

module.exports = { prospectar, listarSegmentos };
