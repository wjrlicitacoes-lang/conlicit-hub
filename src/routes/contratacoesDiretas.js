const express    = require('express');
const router     = express.Router();
const autenticar = require('../middleware/autenticar');
const ctrl       = require('../controllers/contratacoesDiretasController');

// Pública — autenticada via x-make-token no controller
router.post('/processar', ctrl.processar);

// Protegidas por JWT
router.get('/listar',      autenticar, ctrl.listar);
router.patch('/:id/status', autenticar, ctrl.atualizarStatus);
router.get('/cnpj/:cnpj',  autenticar, ctrl.buscarCnae);

module.exports = router;
