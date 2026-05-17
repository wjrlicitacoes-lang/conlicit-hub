const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

// Verifica se a API está no ar
router.get('/', healthController.verificarSaude);

module.exports = router;
