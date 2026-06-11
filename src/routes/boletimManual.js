'use strict';
const express = require('express');
const router  = express.Router();
const { triar, gerarHtml, disparar } = require('../controllers/boletimManualController');

router.post('/triar',      triar);
router.post('/gerar-html', gerarHtml);
router.post('/disparar',   disparar);

module.exports = router;
