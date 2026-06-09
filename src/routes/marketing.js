'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/marketingController');

router.get('/',              ctrl.listarCampanhas);
router.post('/',             ctrl.criarCampanha);
router.put('/:id',           ctrl.editarCampanha);
router.delete('/:id',        ctrl.excluirCampanha);
router.post('/:id/disparar', ctrl.dispararCampanha);
router.get('/:id/leads',     ctrl.leadsParaCampanha);

module.exports = router;
