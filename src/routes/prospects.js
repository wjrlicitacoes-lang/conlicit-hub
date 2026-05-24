const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/prospectsController');

router.get('/',       ctrl.listar);
router.post('/',      ctrl.criar);
router.patch('/:id',  ctrl.atualizar);

module.exports = router;
