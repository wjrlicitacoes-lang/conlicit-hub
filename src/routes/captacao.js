const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/captacaoController');
router.post('/lead',     ctrl.receberLead);
router.post('/analisar', ctrl.analisarPublico);
const prosp = require('../controllers/prospeccaoController');
router.get('/prospectar', prosp.prospectar);
router.get('/segmentos',  prosp.listarSegmentos);
module.exports = router;
