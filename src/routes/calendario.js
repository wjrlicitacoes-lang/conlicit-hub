const express = require('express');
const router = express.Router();
const autenticar = require('../middleware/autenticar');
const { listar, definirHorario, excluir } = require('../controllers/calendarioController');

router.get('/', listar);
router.patch('/:pid', definirHorario);
router.delete('/:id', autenticar, excluir);

module.exports = router;
