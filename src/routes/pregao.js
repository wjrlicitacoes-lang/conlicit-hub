const express = require('express');
const multer = require('multer');
const router = express.Router();

const documentos = require('../controllers/pregaoDocumentosController');
const checklist   = require('../controllers/pregaoChecklistController');
const historico    = require('../controllers/pregaoHistoricoController');
const propostas     = require('../controllers/pregaoPropostasController');
const { importarCSV } = require('../controllers/pregoesController');

const uploadCSV = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/import/csv', uploadCSV.single('arquivo'), importarCSV);

router.get('/:pid/documentos',              documentos.listar);
router.post('/:pid/documentos', documentos.uploadMulter.single('arquivo'), documentos.upload);
router.delete('/:pid/documentos/:docId',    documentos.remover);

router.get('/:pid/checklist',               checklist.listar);
router.patch('/:pid/checklist/:itemId',     checklist.marcar);

router.get('/:pid/historico',               historico.listar);

router.post('/:pid/gerar-proposta',         propostas.gerar);
router.get('/:pid/propostas',               propostas.listar);

module.exports = router;
