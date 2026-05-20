const express = require('express');
const { cadastrar, listar, atualizar, stats } = require('../controllers/clientesController');
const pregoes          = require('../controllers/pregoesController');
const mensalidades     = require('../controllers/mensalidadesController');
const documentos       = require('../controllers/documentosController');
const protegerCliente  = require('../middleware/protegerCliente');

const router = express.Router();

// /clientes/stats antes de /:id para não ser capturado como parâmetro de ID
router.get('/stats', stats);

router.post('/',     cadastrar);
router.get('/',      listar);
router.patch('/:id', atualizar);

// Sub-recursos de cliente (protegerCliente garante que role=cliente só acessa o próprio id)
router.get('/:id/pregoes',             protegerCliente, pregoes.listar);
router.post('/:id/pregoes',            pregoes.criar);       // bloqueado no controller para cliente
router.patch('/:id/pregoes/:pid',      protegerCliente, pregoes.atualizar);
router.delete('/:id/pregoes/:pid',     pregoes.remover);     // bloqueado no controller para cliente

router.get('/:id/mensalidades',        mensalidades.listar);
router.post('/:id/mensalidades',       mensalidades.criar);
router.patch('/:id/mensalidades/:mid', mensalidades.atualizar);

router.get('/:id/documentos',          documentos.listar);
router.post('/:id/documentos',         documentos.criar);
router.delete('/:id/documentos/:did',  documentos.remover);

module.exports = router;
