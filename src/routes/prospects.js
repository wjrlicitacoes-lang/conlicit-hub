const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/prospectsController');

router.get('/',              ctrl.listar);
router.post('/',             ctrl.criar);
router.patch('/:id',         ctrl.atualizar);
router.delete('/:id',        ctrl.remover);
router.get('/:id/eventos',   ctrl.eventos);
router.post('/:id/analisar', ctrl.analisar);

module.exports = router;
