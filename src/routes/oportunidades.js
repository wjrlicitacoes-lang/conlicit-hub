const router = require('express').Router();
const auth   = require('../middleware/autenticar');
const ctrl   = require('../controllers/oportunidadesController');

router.get   ('/grupos',          auth, ctrl.listarGrupos); // temporário — descobrir IDs de grupos Z-API
router.get   ('/',                auth, ctrl.listar);
router.get   ('/:id',             auth, ctrl.buscarPorId);
router.post  ('/',                auth, ctrl.criar);
router.post  ('/:id/resumo',      auth, ctrl.gerarResumo);
router.post  ('/:id/disparar',    auth, ctrl.disparar);
router.patch ('/:id/resposta',    auth, ctrl.registrarResposta);
router.delete('/:id',                  auth, ctrl.excluir);
router.post  ('/webhook/zapi',         ctrl.webhookZapi); // sem auth — Z-API chama direto

module.exports = router;
