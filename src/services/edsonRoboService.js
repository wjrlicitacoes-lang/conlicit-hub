/**
 * RobôLicit — edsonRoboService.js
 * Lê a análise do Edson e traduz para estratégia do robô.
 *
 * Coloca em: conlicit-hub/src/services/edsonRoboService.js
 *
 * O Edson já sabe:
 *  - valor_estimado do pregão
 *  - itens[] com valor_unitario_estimado
 *  - score (0–100) — qualidade da oportunidade
 *  - riscos[] com nível Alto/Médio/Baixo
 *  - tipo_julgamento (por_item | por_lote | global)
 *  - planilha com preço sugerido = 95% do valor estimado
 *
 * Este serviço usa tudo isso para preencher automaticamente
 * valor_base, valor_minimo e estrategia do robô.
 */

const db = require('../database/db');

// ─────────────────────────────────────────────────────────────
// CONSTANTES DE CALIBRAÇÃO
// ─────────────────────────────────────────────────────────────

// Percentual do valor estimado usado como valor_base
const PCT_BASE    = 0.95;   // 95% — mesmo critério da planilha do Edson

// Percentual mínimo que o robô pode chegar
// Varia conforme o score do Edson e nível de risco
const PCT_MIN = {
  score_alto:   0.82,   // score >= 70 → pode ir até 82% (mais agressivo)
  score_medio:  0.87,   // score 40–69 → até 87%
  score_baixo:  0.92,   // score < 40  → mais conservador, até 92%
};

// Estratégia de lance conforme score e riscos
const ESTRATEGIA_POR_SCORE = {
  score_alto:  'moderado',      // >= 70 → moderado (boa oportunidade, não desperdiçar)
  score_medio: 'conservador',   // 40–69 → conservador (cuidado)
  score_baixo: 'conservador',   // < 40  → muito conservador
};

// Ajuste extra se tem risco Alto detectado pelo Edson
const AJUSTE_RISCO_ALTO = 0.03;   // adiciona +3% ao mínimo (mais cautela)

// ─────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL — chame antes de iniciar o robô
// ─────────────────────────────────────────────────────────────

/**
 * Lê a análise do Edson para um pregão e retorna
 * a configuração completa para o robô.
 *
 * @param {number} pregao_id
 * @param {number} cliente_id
 * @returns {object} config de estratégia pronta para o robô
 */
async function gerarEstrategiaDoEdson(pregao_id, cliente_id) {

  // 1. Busca análise do Edson + dados do pregão
  const { rows: [dados] } = await db.query(
    `SELECT
       a.score,
       a.score_justificativa,
       a.riscos,
       a.itens,
       a.tipo_julgamento,
       a.modalidade,
       a.modo_disputa,
       a.resumo_executivo,
       p.valor_estimado,
       p.numero,
       p.objeto,
       p.portal_disputa,
       p.robo_valor_base,
       p.robo_valor_minimo,
       p.robo_estrategia
     FROM analises_edson a
     JOIN pregoes p ON p.id = a.pregao_id
     WHERE a.pregao_id = $1
       AND a.status = 'pronto'`,
    [pregao_id]
  );

  if (!dados) {
    return {
      disponivel: false,
      motivo: 'Análise do Edson não encontrada ou ainda não concluída para este pregão.',
    };
  }

  // 2. Parse dos campos JSON
  const riscos  = _parseJSON(dados.riscos,  []);
  const itens   = _parseJSON(dados.itens,   []);
  const score   = dados.score ?? 50;

  // 3. Calcular valor base e mínimo
  const { valorBase, valorMinimo, faixaScore } = _calcularValores(dados, riscos, score, itens);

  if (!valorBase || valorBase <= 0) {
    return {
      disponivel: false,
      motivo: 'Não foi possível calcular o valor base. Verifique se o valor estimado está preenchido no pregão.',
    };
  }

  // 4. Determinar estratégia
  const estrategia = ESTRATEGIA_POR_SCORE[faixaScore];
  const reducaoPct = estrategia === 'agressivo' ? 1.0 : estrategia === 'moderado' ? 0.5 : 0.3;

  // 5. Detectar riscos altos para alertar o operador
  const riscosAltos = riscos.filter(r => r.nivel === 'Alto').map(r => r.risco);

  // 6. Montar justificativa legível
  const justificativa = _montarJustificativa({
    score, faixaScore, valorBase, valorMinimo,
    estrategia, riscosAltos, dados
  });

  // 7. Verificar se já tem config manual (não sobrescrever se operador configurou)
  const jaConfigurado = dados.robo_valor_base && dados.robo_valor_minimo;

  return {
    disponivel: true,
    ja_configurado: jaConfigurado,
    sugestao: {
      valor_base:   Math.round(valorBase   * 100) / 100,
      valor_minimo: Math.round(valorMinimo * 100) / 100,
      estrategia,
      reducao_pct:  reducaoPct,
      modo_final:   score >= 70 ? 'agressivo' : 'manter',
    },
    contexto: {
      score,
      faixa:             faixaScore,
      tipo_julgamento:   dados.tipo_julgamento,
      total_itens:       itens.length,
      riscos_altos:      riscosAltos,
      resumo_executivo:  dados.resumo_executivo,
    },
    justificativa,
  };
}

// ─────────────────────────────────────────────────────────────
// APLICAR SUGESTÃO DO EDSON NO PREGÃO
// ─────────────────────────────────────────────────────────────

/**
 * Aplica a sugestão do Edson como configuração do robô no pregão.
 * Só aplica se o pregão ainda não tiver config manual.
 *
 * @param {number} pregao_id
 * @param {number} cliente_id
 * @param {boolean} forcar — sobrescreve mesmo se já configurado
 */
async function aplicarEstrategiaDoEdson(pregao_id, cliente_id, forcar = false) {
  const resultado = await gerarEstrategiaDoEdson(pregao_id, cliente_id);

  if (!resultado.disponivel) {
    return { aplicado: false, motivo: resultado.motivo };
  }

  if (resultado.ja_configurado && !forcar) {
    return {
      aplicado: false,
      motivo: 'Pregão já tem estratégia configurada manualmente. Use forcar=true para sobrescrever.',
      sugestao: resultado.sugestao,
    };
  }

  const { valor_base, valor_minimo, estrategia, reducao_pct, modo_final } = resultado.sugestao;

  await db.query(
    `UPDATE pregoes SET
       robo_valor_base   = $1,
       robo_valor_minimo = $2,
       robo_estrategia   = $3,
       robo_reducao_pct  = $4,
       robo_modo_final   = $5
     WHERE id = $6 AND cliente_id = $7`,
    [valor_base, valor_minimo, estrategia, reducao_pct, modo_final, pregao_id, cliente_id]
  );

  return {
    aplicado: true,
    mensagem: `Estratégia aplicada automaticamente com base na análise do Edson (score ${resultado.contexto.score}/100).`,
    ...resultado,
  };
}

// ─────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────

function _calcularValores(dados, riscos, score, itens) {
  const valorEstimado = parseFloat(dados.valor_estimado) || 0;

  // Faixa de score
  const faixaScore = score >= 70 ? 'score_alto'
                   : score >= 40 ? 'score_medio'
                   : 'score_baixo';

  // Verifica se tem risco Alto
  const temRiscoAlto = riscos.some(r => r.nivel === 'Alto');

  // Percentual mínimo base + ajuste por risco
  let pctMin = PCT_MIN[faixaScore];
  if (temRiscoAlto) pctMin = Math.min(pctMin + AJUSTE_RISCO_ALTO, 0.95);

  // Valor base = 95% do estimado (mesmo critério da planilha do Edson)
  const valorBase = valorEstimado * PCT_BASE;

  // Valor mínimo
  const valorMinimo = valorEstimado * pctMin;

  // Se tem itens, calcula como soma dos valores sugeridos (95% item a item)
  if (itens.length > 0) {
    const somaItens = itens.reduce((acc, item) => {
      const qtd = parseFloat(item.quantidade) || 1;
      const vUnit = parseFloat(item.valor_unitario_estimado) || 0;
      return acc + (qtd * vUnit * PCT_BASE);
    }, 0);

    if (somaItens > 0) {
      return {
        valorBase:   somaItens,
        valorMinimo: somaItens * (pctMin / PCT_BASE),
        faixaScore,
      };
    }
  }

  return { valorBase, valorMinimo, faixaScore };
}

function _montarJustificativa({ score, faixaScore, valorBase, valorMinimo, estrategia, riscosAltos, dados }) {
  const faixaLabel = faixaScore === 'score_alto' ? 'Alta' : faixaScore === 'score_medio' ? 'Regular' : 'Baixa';
  const pctMin = ((valorMinimo / valorBase) * 100).toFixed(1);
  const linhas = [
    `📊 Score Edson: ${score}/100 (${faixaLabel})`,
    `💰 Valor base sugerido: R$ ${valorBase.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (95% do estimado)`,
    `🔻 Valor mínimo: R$ ${valorMinimo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${pctMin}% do base)`,
    `⚙️ Estratégia: ${estrategia}`,
  ];
  if (riscosAltos.length > 0) {
    linhas.push(`⚠️ Riscos Altos detectados: ${riscosAltos.slice(0, 2).join(' | ')}`);
    linhas.push(`   → Valor mínimo ajustado +3% por precaução`);
  }
  if (dados.resumo_executivo) {
    linhas.push(`📝 Edson: "${dados.resumo_executivo.slice(0, 120)}..."`);
  }
  return linhas.join('\n');
}

function _parseJSON(valor, fallback) {
  if (Array.isArray(valor)) return valor;
  if (!valor) return fallback;
  try { return JSON.parse(valor); } catch { return fallback; }
}

module.exports = { gerarEstrategiaDoEdson, aplicarEstrategiaDoEdson };
