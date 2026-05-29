const router = require('express').Router();
const auth   = require('../middleware/autenticar');
const ctrl   = require('../controllers/oportunidadesController');

router.post  ('/webhook/zapi',    ctrl.webhookZapi);
router.get   ('/grupos',          auth, ctrl.listarGrupos);
router.get   ('/',                auth, ctrl.listar);
router.post  ('/',                auth, ctrl.criar);
router.get   ('/:id',             auth, ctrl.buscarPorId);
router.post  ('/:id/resumo',      auth, ctrl.gerarResumo);
router.post  ('/:id/disparar',    auth, ctrl.disparar);
router.patch ('/:id/resposta',    auth, ctrl.registrarResposta);
router.delete('/:id',             auth, ctrl.excluir);

module.exports = router;
