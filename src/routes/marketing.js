'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/marketingController');

// Configuração e status Brevo (rotas fixas antes de /:id)
router.get('/brevo/status',  ctrl.brevoStatus);
router.get('/config',        ctrl.getConfig);
router.post('/config',       ctrl.saveConfig);

// Campanhas
router.get('/',              ctrl.listarCampanhas);
router.post('/',             ctrl.criarCampanha);
router.put('/:id',           ctrl.editarCampanha);
router.delete('/:id',        ctrl.excluirCampanha);
router.post('/:id/disparar', ctrl.dispararCampanha);
router.get('/:id/leads',     ctrl.leadsParaCampanha);

module.exports = router;
