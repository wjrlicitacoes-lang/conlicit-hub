const express = require('express');
const {
  criar,
  listar,
  obter,
  atualizar,
  remover,
  gerar,
} = require('../controllers/apresentacaoController');

const router = express.Router();

router.get('/', listar);
router.get('/:id/gerar', gerar);
router.get('/:id', obter);
router.post('/', criar);
router.patch('/:id', atualizar);
router.delete('/:id', remover);

module.exports = router;
