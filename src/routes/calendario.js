const express = require('express');
const router = express.Router();
const { listar, definirHorario } = require('../controllers/calendarioController');

router.get('/', listar);
router.patch('/:pid', definirHorario);

module.exports = router;
