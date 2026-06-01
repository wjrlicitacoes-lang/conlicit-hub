// src/controllers/prospeccaoController.js
// Busca automática de leads via PNCP
// Encontra empresas que participaram de pregões e não venceram
// Salva automaticamente na tabela prospects

const axios = require('axios');
const db    = require('../database/db');

const PNCP_CONSULTA = 'https://pncp.gov.br/api/consulta/v1';
const PNCP_BASE     = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/pncp/v1';
const CNPJ_API      = 'https://publica.cnpj.ws/cnpj'; // API pública gratuita

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
  'alimentacao':       ['gêneros alimentícios', 'alimentação escolar', 'merenda', 'alimentos'],
  'material_escritorio': ['material de escritório', 'papel A4', 'cartuchos', 'material escolar'],
  'limpeza':           ['material de limpeza', 'produtos de limpeza', 'higienização', 'limpeza'],
  'ti':                ['computador', 'notebook', 'impressora', 'equipamentos de informática', 'TI'],
  'saude':             ['medicamentos', 'material hospitalar', 'EPI', 'equipamentos médicos'],
  'servicos_limpeza':  ['serviços de limpeza', 'limpeza predial', 'conservação e limpeza'],
  'vigilancia':        ['vigilância', 'segurança patrimonial', 'monitoramento'],
  'manutencao':        ['manutenção predial', 'reforma', 'serviços de manutenção'],
};

// ── Busca pregões homologados no PNCP ────────────────────────────────────────

async function buscarPregoesHomologados({ palavraChave, uf, diasAtras = 90, pagina = 1 }) {
  const hoje    = new Date();
  const dataFim = hoje.toISOString().slice(0, 10).replace(/-/g, '');
  const dataIni = new Date(hoje - diasAtras * 86400000).toISOString().slice(0, 10).replace(/-/g, '');

  try {
    const { data } = await axios.get(`${PNCP_CONSULTA}/contratacoes/publicacao`, {
      params: {
        dataInicial: dataIni,
        dataFinal:   dataFim,
        pagina,
        tamanhoPagina: 20,
        codigoModalidadeContratacao: 6, // 6 = Pregão Eletrônico
      },
      timeout: 15000,
    });

    const todos = data.data ?? [];

    // Filtra por palavra-chave e UF localmente
    return todos.filter(p => {
      const objeto = (p.objetoCompra || '').toLowerCase();
      const ufP    = p.unidadeOrgao?.ufSigla || '';
      const matchObj = palavraChave ? objeto.includes(palavraChave.toLowerCase()) : true;
      const matchUF  = uf ? ufP.toUpperCase() === uf.toUpperCase() : true;
      return matchObj && matchUF;
    });
  } catch (e) {
    console.warn('[Prospecção] Falha ao buscar PNCP:', e.message);
    return [];
  }
}

// ── Busca participantes de um pregão específico ───────────────────────────────

async function buscarParticipantes(cnpjOrgao, ano, sequencial) {
  try {
    const { data } = await axios.get(
      `${PNCP_BASE}/orgaos/${cnpjOrgao}/compras/${ano}/${sequencial}/itens/1/propostas`,
      { timeout: 10000 }
    );
    return Array.isArray(data) ? data : (data.data ?? []);
  } catch {
    // Tenta endpoint alternativo
    try {
      const { data } = await axios.get(
        `${PNCP_BASE}/orgaos/${cnpjOrgao}/compras/${ano}/${sequencial}/propostas`,
        { timeout: 10000 }
      );
      return Array.isArray(data) ? data : (data.data ?? []);
    } catch {
      return [];
    }
  }
}

// ── Enriquece empresa via CNPJ público ───────────────────────────────────────

async function enriquecerCNPJ(cnpj) {
  const cnpjLimpo = limparCNPJ(cnpj);
  if (cnpjLimpo.length !== 14) return null;

  try {
    await sleep(300); // respeita rate limit da API pública
    const { data } = await axios.get(`${CNPJ_API}/${cnpjLimpo}`, { timeout: 8000 });
    const socios = data.socios || [];
    const responsavel = socios.length > 0
      ? socios[0].nome_socio_pf || socios[0].nome_socio || null
      : null;

    // Telefone: pega o primeiro disponível
    const tel = data.ddd_telefone_1
      ? `(${data.ddd_telefone_1.slice(0, 2)}) ${data.ddd_telefone_1.slice(2)}`
      : null;

    return {
      razao_social: data.razao_social || null,
      nome_fantasia: data.nome_fantasia || null,
      responsavel,
      telefone: tel,
      email: data.email || null,
      municipio: data.municipio || null,
      uf: data.uf || null,
      cnae_principal: data.cnae_fiscal_descricao || null,
      porte: data.porte || null,
    };
  } catch {
    return null;
  }
}

// ── Controller principal ──────────────────────────────────────────────────────

// GET /captacao/prospectar?segmento=alimentacao&uf=SP&dias=90&limite=20
async function prospectar(req, res) {
  const {
    segmento = 'alimentacao',
    uf,
    dias = 90,
    limite = 20,
    enriquecer = 'true',
  } = req.query;

  // Resolve palavras-chave do segmento
  const palavrasChave = SEGMENTOS[segmento] || [segmento];

  res.setHeader('Content-Type', 'application/json');

  const leadsEncontrados = [];
  const cnpjsProcessados = new Set();
  let pregoesAnalisados  = 0;

  try {
    for (const palavra of palavrasChave) {
      if (leadsEncontrados.length >= Number(limite)) break;

      const pregoes = await buscarPregoesHomologados({
        palavraChave: palavra,
        uf,
        diasAtras: Number(dias),
      });

      for (const pregao of pregoes) {
        if (leadsEncontrados.length >= Number(limite)) break;

        const cnpjOrgao    = pregao.orgaoEntidade?.cnpj;
        const ano          = pregao.anoCompra;
        const sequencial   = pregao.sequencialCompra;
        const objeto       = pregao.objetoCompra || '';
        const valorEst     = pregao.valorTotalEstimado || 0;
        const numeroPregao = pregao.numeroControlePNCP || `${cnpjOrgao}-${ano}-${sequencial}`;

        if (!cnpjOrgao || !ano || !sequencial) continue;
        pregoesAnalisados++;

        await sleep(200); // respeita rate limit do PNCP
        const participantes = await buscarParticipantes(cnpjOrgao, ano, sequencial);
        if (participantes.length === 0) continue;

        // Identifica vencedor (menor preço ou primeiro colocado)
        const sorted = [...participantes].sort((a, b) =>
          (a.valorTotal || a.valorProposta || 0) - (b.valorTotal || b.valorProposta || 0)
        );
        const cnpjVencedor = sorted[0]?.fornecedor?.cnpj || sorted[0]?.cnpj;

        // Empresas que participaram mas não venceram = nosso alvo
        for (const p of sorted.slice(1)) {
          if (leadsEncontrados.length >= Number(limite)) break;

          const cnpjForn = limparCNPJ(p.fornecedor?.cnpj || p.cnpj);
          if (!cnpjForn || cnpjForn.length !== 14) continue;
          if (cnpjsProcessados.has(cnpjForn)) continue;
          cnpjsProcessados.add(cnpjForn);

          // Determina posição e motivo
          const posicao = sorted.indexOf(p) + 1;
          const desclassificada = p.situacaoCompra === 'Desclassificada' ||
            p.situacaoProposta?.toLowerCase()?.includes('desclass');
          const motivoDesclass = desclassificada
            ? (p.motivoDesclassificacao || p.justificativa || 'Desclassificada')
            : null;

          // Enriquece com dados da Receita se solicitado
          let dadosCNPJ = null;
          if (enriquecer === 'true') {
            dadosCNPJ = await enriquecerCNPJ(cnpjForn);
          }

          const lead = {
            cnpj: formatarCNPJ(cnpjForn),
            razao_social: dadosCNPJ?.razao_social || p.fornecedor?.razaoSocial || p.razaoSocial || null,
            nome_fantasia: dadosCNPJ?.nome_fantasia || null,
            responsavel: dadosCNPJ?.responsavel || null,
            telefone: dadosCNPJ?.telefone || null,
            email: dadosCNPJ?.email || null,
            municipio: dadosCNPJ?.municipio || null,
            uf: dadosCNPJ?.uf || uf || null,
            segmento: segmento,
            // Contexto do pregão
            pregao_numero: numeroPregao,
            pregao_objeto: objeto,
            pregao_valor: valorEst,
            posicao_pregao: posicao,
            desclassificada,
            motivo_desclassificacao: motivoDesclass,
            prioridade: desclassificada ? 'Alta' : (posicao <= 3 ? 'Alta' : 'Média'),
          };

          leadsEncontrados.push(lead);

          // Salva automaticamente na tabela prospects
          try {
            const nota = [
              `[Lead via Prospecção PNCP — ${new Date().toLocaleDateString('pt-BR')}]`,
              `Pregão: ${numeroPregao}`,
              `Objeto: ${objeto}`,
              `Valor estimado: R$ ${valorEst?.toLocaleString('pt-BR') || '—'}`,
              `Posição: ${posicao}º lugar`,
              desclassificada ? `Desclassificada: ${motivoDesclass}` : '',
            ].filter(Boolean).join('\n');

            await db.query(
              `INSERT INTO prospects
                 (nome, email, whatsapp, empresa, segmento, status, notas, responsavel)
               VALUES ($1, $2, $3, $4, $5, 'em_negociacao', $6, 'PNCP Auto')
               ON CONFLICT DO NOTHING`,
              [
                dadosCNPJ?.responsavel || lead.razao_social || 'A identificar',
                dadosCNPJ?.email || null,
                dadosCNPJ?.telefone || null,
                lead.razao_social,
                segmento,
                nota,
              ]
            );
          } catch (dbErr) {
            console.warn('[Prospecção] Falha ao salvar prospect:', dbErr.message);
          }
        }
      }
    }

    return res.json({
      sucesso: true,
      segmento,
      uf: uf || 'todos',
      dias_analisados: Number(dias),
      pregoes_analisados: pregoesAnalisados,
      leads_encontrados: leadsEncontrados.length,
      leads: leadsEncontrados,
    });

  } catch (e) {
    console.error('[Prospecção] Erro:', e.message);
    return res.status(500).json({ erro: 'Erro ao prospectar. Tente novamente.' });
  }
}

// GET /captacao/segmentos — lista segmentos disponíveis
function listarSegmentos(req, res) {
  return res.json({
    segmentos: Object.keys(SEGMENTOS).map(k => ({
      id: k,
      label: k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      palavras_chave: SEGMENTOS[k],
    }))
  });
}

module.exports = { prospectar, listarSegmentos };
