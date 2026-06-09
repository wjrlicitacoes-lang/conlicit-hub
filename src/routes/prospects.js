const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/prospectsController');
const email   = require('../controllers/emailProspectController');

router.get('/',                ctrl.listar);
router.post('/',               ctrl.criar);
// estáticas antes de /:id para não serem capturadas como param
router.get('/followup',        ctrl.followup);
router.get('/kpis',            ctrl.kpis);
router.get('/modelo-planilha', ctrl.modeloPlanilha);
router.get('/exportar',        ctrl.exportarLote);
router.post('/importar-planilha', ctrl.upload.single('arquivo'), ctrl.importarPlanilha);
router.post('/lote/status',    ctrl.atualizarStatusLote);
router.get('/email-templates',     email.listarTemplates);
router.post('/email-templates',    email.criarTemplate);
router.get('/email-logs-global',   email.listarLogsGlobal);
router.post('/campanha',           email.enviarCampanha);
router.get('/:id',             ctrl.obterPorId);
router.patch('/:id',           ctrl.atualizar);
router.patch('/:id/status',    ctrl.atualizarStatus);
router.delete('/:id',          ctrl.remover);
router.get('/:id/eventos',     ctrl.eventos);
router.post('/:id/analisar',   ctrl.analisar);
router.post('/:id/interacoes', ctrl.registrarInteracao);
router.post('/:id/enviar-email', email.enviarEmailProspect);
router.get('/:id/email-logs',    email.listarLogsProspect);

module.exports = router;
