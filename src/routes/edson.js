const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/edsonController');

router.get('/',                    ctrl.listar);
router.post('/:pregao_id',         ctrl.disparar);
router.get('/:pregao_id/planilha',  ctrl.planilha);
router.get('/:pregao_id/relatorio', ctrl.relatorio);
router.get('/:pregao_id/chat',      ctrl.getChatHistorico);
router.post('/:pregao_id/chat',    ctrl.chat);
router.get('/:pregao_id',          ctrl.obter);

module.exports = router;
