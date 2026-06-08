// ─────────────────────────────────────────────────────────────────────────────
// edsonPlanilhaController.js
// Conlicit Hub | Edson — Módulo Planilha de Preços
//
// Endpoints:
//   POST /edson/analise/:analise_id/planilha-precos/itens-edital
//     → extrai todos os itens do edital já analisado
//
//   POST /edson/analise/:analise_id/planilha-precos/selecao
//     → salva quais itens a consultora vai disputar
//
//   POST /edson/analise/:analise_id/planilha-precos/pesquisar
//     → pesquisa 3 opções de mercado para cada item selecionado
//
//   GET  /edson/analise/:analise_id/planilha-precos
//     → retorna estado atual (itens extraídos, seleção, pesquisa)
//
//   POST /edson/analise/:analise_id/planilha-precos/gerar-csv
//     → gera e faz download do CSV final com as opções escolhidas
// ─────────────────────────────────────────────────────────────────────────────

const db  = require('../database/db');
const svc = require('../services/edsonPlanilhaService');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buscarAnalise(analise_id) {
  const { rows: [analise] } = await db.query(
    `SELECT ae.id, ae.status, ae.referencia, ae.itens, ae.cliente_id,
            ae.itens_planilha_selecao, ae.itens_planilha_pesquisa,
            c.nome AS cliente_nome, c.palavras_chave AS segmento,
            p.numero AS pregao_numero, p.orgao
     FROM analises_edson ae
     LEFT JOIN clientes c ON c.id = ae.cliente_id
     LEFT JOIN pregoes  p ON p.id = ae.pregao_id
     WHERE ae.id = $1`,
    [analise_id],
  );
  return analise;
}

// ── GET /edson/analise/:analise_id/planilha-precos ────────────────────────────
// Retorna o estado completo da planilha (itens, seleção e pesquisa)

async function obterEstado(req, res) {
  const { analise_id } = req.params;
  try {
    const analise = await buscarAnalise(analise_id);
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });

    const dados = await svc.carregarDadosPlanilha(analise_id);

    return res.json({
      analise_id:       parseInt(analise_id),
      referencia:       analise.referencia,
      pregao_numero:    analise.pregao_numero,
      orgao:            analise.orgao,
      cliente_nome:     analise.cliente_nome,
      status_analise:   analise.status,
      itens_edital:     analise.itens || [],
      itens_selecao:    dados.itens_planilha_selecao || [],
      itens_pesquisa:   dados.itens_planilha_pesquisa || [],
    });
  } catch (e) {
    console.error('[EdsonPlanilha] obterEstado:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── POST /edson/analise/:analise_id/planilha-precos/itens-edital ─────────────
// Extrai itens do texto bruto do edital (já salvo na análise)
// Se a análise tiver status "pronto", usa os itens já extraídos pelo Edson.
// Se não houver itens estruturados, pede texto do edital e reextrai.

async function extrairItens(req, res) {
  const { analise_id } = req.params;
  try {
    const analise = await buscarAnalise(analise_id);
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });

    // Se a análise já tem itens extraídos, devolve direto
    if (analise.itens && analise.itens.length > 0) {
      return res.json({
        fonte:       'analise_existente',
        total_itens: analise.itens.length,
        itens:       analise.itens,
      });
    }

    // Caso contrário, exige texto do edital no body para reextrair
    const { texto_edital } = req.body ?? {};
    if (!texto_edital?.trim()) {
      return res.status(400).json({
        erro: 'Análise não possui itens. Envie texto_edital no body para extrair.',
      });
    }

    const paginasItens = req.body?.paginas_itens || req.query?.paginas_itens || null;
    const resultado = await svc.extrairItensDoEdital(texto_edital, paginasItens);

    // Persiste os itens na análise
    await db.query(
      `UPDATE analises_edson SET itens = $1, atualizado_em = NOW() WHERE id = $2`,
      [JSON.stringify(resultado.itens), analise_id],
    );

    return res.json({
      fonte:       'extracao_nova',
      pregao:      resultado.pregao,
      total_itens: resultado.total_itens,
      itens:       resultado.itens,
    });
  } catch (e) {
    console.error('[EdsonPlanilha] extrairItens:', e.message);
    return res.status(500).json({ erro: `Erro ao extrair itens: ${e.message}` });
  }
}

// ── POST /edson/analise/:analise_id/planilha-precos/selecao ───────────────────
// Salva quais itens a consultora escolheu disputar
// Body: { itens_selecionados: [{ numero, descricao, unidade, quantidade, valor_referencia }] }

async function salvarSelecao(req, res) {
  const { analise_id } = req.params;
  const { itens_selecionados } = req.body ?? {};

  if (!Array.isArray(itens_selecionados) || itens_selecionados.length === 0) {
    return res.status(400).json({ erro: 'itens_selecionados deve ser um array não vazio' });
  }

  // Valida campos obrigatórios de cada item
  for (const item of itens_selecionados) {
    if (!item.numero || !item.descricao || !item.unidade || item.quantidade == null) {
      return res.status(400).json({
        erro: `Item inválido: ${JSON.stringify(item)}. Campos obrigatórios: numero, descricao, unidade, quantidade`,
      });
    }
  }

  try {
    const analise = await buscarAnalise(analise_id);
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });

    await svc.salvarSelecao(analise_id, itens_selecionados);

    return res.json({
      mensagem:          `${itens_selecionados.length} itens salvos`,
      analise_id:        parseInt(analise_id),
      itens_selecionados: itens_selecionados.length,
    });
  } catch (e) {
    console.error('[EdsonPlanilha] salvarSelecao:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── POST /edson/analise/:analise_id/planilha-precos/pesquisar ─────────────────
// Pesquisa 3 opções de mercado para cada item selecionado.
// Usa os itens salvos na seleção (ou aceita itens_selecionados no body).
// Body opcional: { segmento_cliente: "materiais esportivos" }

async function pesquisarPrecos(req, res) {
  const { analise_id } = req.params;
  const { segmento_cliente, itens_selecionados: itensBody } = req.body ?? {};

  try {
    const analise = await buscarAnalise(analise_id);
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });

    // Prioridade: body > banco
    const dadosBanco = await svc.carregarDadosPlanilha(analise_id);
    const itens = itensBody || dadosBanco.itens_planilha_selecao;

    if (!itens || itens.length === 0) {
      return res.status(400).json({
        erro: 'Nenhum item selecionado. Faça POST /selecao antes de pesquisar.',
      });
    }

    // Detecta segmento pelo cliente se não informado
    const segmento = segmento_cliente
      || (Array.isArray(analise.segmento) ? analise.segmento.join(', ') : analise.segmento)
      || 'geral';

    // Inicia pesquisa em background e retorna confirmação imediata
    // (pesquisa pode demorar 30–120s dependendo da quantidade de itens)
    res.json({
      mensagem:    `Pesquisando preços para ${itens.length} itens. Consulte GET /planilha-precos para acompanhar.`,
      analise_id:  parseInt(analise_id),
      total_itens: itens.length,
      segmento,
    });

    // Executa pesquisa e salva resultado em background
    svc.pesquisarPrecosLote(itens, segmento)
      .then(resultados => svc.salvarPesquisa(analise_id, resultados))
      .catch(err => console.error('[EdsonPlanilha] pesquisa background:', err.message));

  } catch (e) {
    console.error('[EdsonPlanilha] pesquisarPrecos:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── POST /edson/analise/:analise_id/planilha-precos/gerar-csv ─────────────────
// Gera o CSV final para download.
// Body: { itens: [{ item: {...}, opcaoEscolhida: {...} }] }
// Se não houver body.itens, usa a pesquisa salva com a opção 1 (menor preço) de cada item.

async function gerarCSV(req, res) {
  const { analise_id } = req.params;
  const { itens: itensBody } = req.body ?? {};

  try {
    const analise = await buscarAnalise(analise_id);
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });

    let itensParaCSV = itensBody;

    // Se não vieram itens no body, monta automaticamente com a pesquisa salva
    if (!itensParaCSV || itensParaCSV.length === 0) {
      const dados = await svc.carregarDadosPlanilha(analise_id);
      const selecao  = dados.itens_planilha_selecao  || [];
      const pesquisa = dados.itens_planilha_pesquisa || [];

      if (pesquisa.length === 0) {
        return res.status(400).json({
          erro: 'Nenhuma pesquisa salva. Faça POST /pesquisar antes de gerar o CSV.',
        });
      }

      // Combina seleção com a opção 1 (menor preço) de cada pesquisa
      itensParaCSV = pesquisa
        .filter(p => p.opcoes && p.opcoes.length > 0)
        .map(p => ({
          item:          selecao.find(s => s.numero === p.item_numero) || { numero: p.item_numero, descricao: p.descricao_edital, unidade: 'un', quantidade: 1 },
          opcaoEscolhida: p.opcoes[0],
        }));
    }

    if (itensParaCSV.length === 0) {
      return res.status(400).json({ erro: 'Nenhum item com opção disponível para gerar CSV' });
    }

    const csv = await svc.gerarCSV(itensParaCSV);

    const referencia = analise.pregao_numero || analise.referencia || analise_id;
    const filename   = `planilha-precos-${referencia.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // BOM UTF-8 para o Excel abrir corretamente no Windows
    return res.send('\uFEFF' + csv);

  } catch (e) {
    console.error('[EdsonPlanilha] gerarCSV:', e.message);
    return res.status(500).json({ erro: `Erro ao gerar CSV: ${e.message}` });
  }
}

module.exports = { obterEstado, extrairItens, salvarSelecao, pesquisarPrecos, gerarCSV };
