const express = require('express');
const multer  = require('multer');
const { cadastrar, listar, atualizar, stats, pregoesVencidos, dashboardStats } = require('../controllers/clientesController');
const pregoes          = require('../controllers/pregoesController');

const mensalidades     = require('../controllers/mensalidadesController');
const documentos       = require('../controllers/documentosController');
const acessos          = require('../controllers/acessosController');
const protegerCliente  = require('../middleware/protegerCliente');

const router = express.Router();

const _uploadPregao = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, f.mimetype === 'application/pdf'),
});

// Rotas fixas antes de /:id para não capturar como parâmetro de ID
router.get('/stats',           stats);
router.get('/vencidos',        pregoesVencidos);
router.get('/dashboard-stats', dashboardStats);
router.get('/pregoes',  pregoes.listarTodos);

router.post('/',     cadastrar);
router.get('/',      listar);
router.patch('/:id', atualizar);

// Sub-recursos de cliente (protegerCliente garante que role=cliente só acessa o próprio id)
router.get('/:id/pregoes',             protegerCliente, pregoes.listar);
router.post('/:id/pregoes', _uploadPregao.single('edital_pdf'), pregoes.criar);
router.patch('/:id/pregoes/:pid',      protegerCliente, pregoes.atualizar);
router.delete('/:id/pregoes/:pid',     pregoes.remover);     // bloqueado no controller para cliente

router.get('/:id/mensalidades',        mensalidades.listar);
router.post('/:id/mensalidades',       mensalidades.criar);
router.patch('/:id/mensalidades/:mid', mensalidades.atualizar);

router.get('/:id/documentos',          documentos.listar);
router.post('/:id/documentos',         documentos.criar);
router.delete('/:id/documentos/:did',  documentos.remover);
router.post('/:id/documentos/onboarding', documentos.inicializarOnboarding);
router.patch('/:id/documentos/:did/status', documentos.atualizarStatus);

router.get('/:id/acessos',             acessos.listar);
router.post('/:id/acessos',            acessos.criar);
router.patch('/:id/acessos/:aid',      acessos.atualizar);
router.delete('/:id/acessos/:aid',     acessos.remover);

module.exports = router;
