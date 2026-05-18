const express = require('express');
const { cadastrar, listar, atualizar } = require('../controllers/clientesController');

const router = express.Router();

router.post('/', cadastrar);
router.get('/', listar);
router.patch('/:id', atualizar);

module.exports = router;
