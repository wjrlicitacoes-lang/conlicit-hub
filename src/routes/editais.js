const express = require('express');
const router = express.Router();
const editaisController = require('../controllers/editaisController');

// Lista editais com filtros por data, palavra-chave, UF e modalidade
router.get('/', editaisController.listarEditais);

// Busca um edital específico pelo CNPJ do órgão, ano e sequencial
// Exemplo: GET /editais/00394502000144/2024/1
router.get('/:cnpj/:ano/:sequencial', editaisController.buscarEditalPorId);

module.exports = router;
