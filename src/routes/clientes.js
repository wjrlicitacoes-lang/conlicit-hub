const express = require('express');
const multer  = require('multer');
const { cadastrar, listar, atualizar, stats, pregoesVencidos, dashboardStats } = require('../controllers/clientesController');
const pregoes          = require('../controllers/pregoesController');
const _uploadDoc = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const mensalidades     = require('../controllers/mensalidadesController');
const documentos       = require('../controllers/documentosController');
const acessos          = require('../controllers/acessosController');
const pagamentos       = require('../controllers/pagamentosController');
const protegerCliente  = require('../middleware/protegerCliente');

const router = express.Router();

// role=cliente só pode acessar sub-recursos /:id/..., nunca rotas raiz (lista, stats, cadastro)
router.use((req, res, next) => {
  if (req.usuario?.role !== 'cliente') return next();
  if (/^\/\d+\//.test(req.path)) return next();
  return res.status(403).json({ erro: 'Acesso negado' });
});

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

router.get('/:id/documentos',                documentos.listar);
router.post('/:id/documentos',               documentos.criar);
router.patch('/:id/documentos/:did',         documentos.atualizarMetadados);
router.delete('/:id/documentos/:did',        documentos.remover);
router.post('/:id/documentos/onboarding',    documentos.inicializarOnboarding);
router.patch('/:id/documentos/:did/status',  documentos.atualizarStatus);
router.post('/:id/documentos/:did/upload',   _uploadDoc.single('arquivo'), documentos.upload);

router.get('/:id/acessos',             acessos.listar);
router.post('/:id/acessos',            acessos.criar);
router.patch('/:id/acessos/:aid',      acessos.atualizar);
router.delete('/:id/acessos/:aid',     acessos.remover);

// Pagamentos flexíveis
router.get('/:id/pagamentos/config',                   pagamentos.listarConfigs);
router.post('/:id/pagamentos/config',                  pagamentos.criarConfig);
router.delete('/:id/pagamentos/config/:config_id',     pagamentos.desativarConfig);
router.get('/:id/pagamentos/lancamentos',              pagamentos.listarLancamentos);
router.patch('/:id/pagamentos/lancamentos/:lancamento_id', pagamentos.atualizarLancamento);

module.exports = router;
