/**
 * RobôLicit — Etapa 5
 * PATCH para roboController.js
 *
 * Adicione estas funções ao arquivo existente
 * conlicit-hub/src/controllers/roboController.js
 *
 * E adicione as rotas no routes/robo.js conforme indicado abaixo.
 */

const { gerarEstrategiaDoEdson, aplicarEstrategiaDoEdson } = require('../services/edsonRoboService');

// ──────────────────────────────────────────────────────────────
// GET /robo/:pregao_id/edson-sugestao
// Retorna a sugestão de estratégia baseada no Edson
// sem ainda aplicar — para o operador revisar antes
// ──────────────────────────────────────────────────────────────
async function edsonSugestao(req, res) {
  const pregao_id  = parseInt(req.params.pregao_id, 10);
  const cliente_id = parseInt(req.query.cliente_id, 10);

  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id é obrigatório' });

  try {
    const resultado = await gerarEstrategiaDoEdson(pregao_id, cliente_id);
    return res.json(resultado);
  } catch (e) {
    console.error('[RoboCtrl] edsonSugestao:', e.message);
    return res.status(400).json({ erro: e.message });
  }
}

// ──────────────────────────────────────────────────────────────
// POST /robo/:pregao_id/edson-aplicar
// Aplica a sugestão do Edson como config do robô
// Body: { cliente_id, forcar? }
// ──────────────────────────────────────────────────────────────
async function edsonAplicar(req, res) {
  const pregao_id  = parseInt(req.params.pregao_id, 10);
  const cliente_id = parseInt(req.body.cliente_id, 10);
  const forcar     = req.body.forcar === true || req.body.forcar === 'true';

  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id é obrigatório' });

  try {
    const resultado = await aplicarEstrategiaDoEdson(pregao_id, cliente_id, forcar);
    return res.json(resultado);
  } catch (e) {
    console.error('[RoboCtrl] edsonAplicar:', e.message);
    return res.status(400).json({ erro: e.message });
  }
}

// ──────────────────────────────────────────────────────────────
// TAMBÉM: atualize iniciarRobo no roboService.js
// para chamar aplicarEstrategiaDoEdson automaticamente
// se o pregão ainda não tiver valor_base configurado
// ──────────────────────────────────────────────────────────────
// No início da função iniciarRobo(), ANTES da checagem de valor_base,
// adicione estas linhas:
//
//   const { aplicarEstrategiaDoEdson } = require('./edsonRoboService');
//
//   // Tenta preencher automaticamente via Edson se não configurado
//   if (!pregao.robo_valor_base) {
//     const edson = await aplicarEstrategiaDoEdson(pregao_id, cliente_id, false);
//     if (edson.aplicado) {
//       // Recarrega pregão com os valores recém preenchidos
//       const { rows: [p2] } = await db.query('SELECT * FROM pregoes WHERE id = $1', [pregao_id]);
//       Object.assign(pregao, p2);
//     }
//   }

module.exports = { edsonSugestao, edsonAplicar };

// ──────────────────────────────────────────────────────────────
// ROTAS — adicione em routes/robo.js
// ──────────────────────────────────────────────────────────────
// const { edsonSugestao, edsonAplicar } = require('../controllers/roboEdsonController');
//
// router.get('/:pregao_id/edson-sugestao', edsonSugestao);
// router.post('/:pregao_id/edson-aplicar', edsonAplicar);
