const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/propostasController');

router.get('/proximo-numero', ctrl.proximoNumero);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.buscar);
router.post('/', ctrl.salvar);
router.delete('/:id', ctrl.excluir);

module.exports = router;
