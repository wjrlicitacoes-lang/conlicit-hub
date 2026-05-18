const express = require('express');
const { cadastrar, listar } = require('../controllers/clientesController');

const router = express.Router();

router.post('/', cadastrar);
router.get('/', listar);

module.exports = router;
