/**
 * RobôLicit — routes/robo.js
 * Rotas do módulo robô de lances.
 *
 * Coloca em: conlicit-hub/src/routes/robo.js
 */

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/roboController');

// Listar todos os robôs ativos (só admin/sócio)
router.get('/ativos', ctrl.listarAtivos);

// Credenciais por cliente
router.patch('/credenciais/:cliente_id', ctrl.credenciais);

// Configurar estratégia de um pregão
router.patch('/:pregao_id/configurar', ctrl.configurar);

// Iniciar robô
router.post('/:pregao_id/iniciar', ctrl.iniciar);

// Parar robô
router.post('/:pregao_id/parar', ctrl.parar);

// Status + logs ao vivo
router.get('/:pregao_id/status', ctrl.status);

const edsonCtrl = require('../controllers/roboEdsonController');
router.get('/:pregao_id/edson-sugestao', edsonCtrl.edsonSugestao);
router.post('/:pregao_id/edson-aplicar',  edsonCtrl.edsonAplicar);

module.exports = router;
