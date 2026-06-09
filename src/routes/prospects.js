const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/prospectsController');
const email   = require('../controllers/emailProspectController');

router.get('/',                ctrl.listar);
router.post('/',               ctrl.criar);
// estáticas antes de /:id para não serem capturadas como param
router.get('/followup',        ctrl.followup);
router.get('/kpis',            ctrl.kpis);
router.get('/email-templates', email.listarTemplates);
router.get('/:id',             ctrl.obterPorId);
router.patch('/:id',           ctrl.atualizar);
router.delete('/:id',          ctrl.remover);
router.get('/:id/eventos',     ctrl.eventos);
router.post('/:id/analisar',   ctrl.analisar);
router.post('/:id/interacoes', ctrl.registrarInteracao);
router.post('/:id/enviar-email', email.enviarEmailProspect);
router.get('/:id/email-logs',    email.listarLogsProspect);

module.exports = router;
