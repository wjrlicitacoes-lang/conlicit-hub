const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const autenticar = require('../middleware/autenticar');

router.post('/registrar', authController.registrar);
router.post('/login',     authController.login);
router.get('/me',         autenticar, authController.me);
router.post('/usuarios',     autenticar, authController.criarUsuario);
router.get('/usuarios',      autenticar, authController.listarUsuarios);
router.patch('/usuarios/:id', autenticar, authController.editarUsuario);
router.delete('/usuarios/:id', autenticar, authController.excluirUsuario);

module.exports = router;
