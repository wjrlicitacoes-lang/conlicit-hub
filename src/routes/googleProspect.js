'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/googleProspectController');

router.post('/buscar-google',                    ctrl.buscarGoogle);
router.get('/buscar-google/historico',           ctrl.listarHistoricoGoogle);
router.get('/buscar-google/resultados',          ctrl.listarResultadosGoogle);
router.post('/buscar-google/:id/prospect',       ctrl.adicionarComoProspect);
router.get('/social-templates',                  ctrl.listarSocialTemplates);
router.patch('/social-templates/:id',            ctrl.atualizarTemplate);
router.get('/multicanal/kpis',                   ctrl.kpisMulticanal);

module.exports = router;
