const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/captacaoController');
router.post('/lead',     ctrl.receberLead);
router.post('/analisar', ctrl.analisarPublico);
module.exports = router;
