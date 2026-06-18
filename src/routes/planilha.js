const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/planilhaController');

router.post('/extrair-itens',           ctrl.upload.single('arquivo'), ctrl.extrairItens);
router.get('/planilhas',                ctrl.listarPlanilhas);
router.get('/planilhas/:id/itens',      ctrl.listarItens);
router.patch('/itens/:id',              ctrl.atualizarItem);
router.get('/buscar-preco',             ctrl.buscarPreco);
router.get('/planilhas/:id/exportar-csv', ctrl.exportarCSV);

module.exports = router;
