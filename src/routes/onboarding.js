'use strict';
const express = require('express');
const router = express.Router();
const multer = require('multer');
const autenticar = require('../middleware/autenticar');
const {
  gerarToken,
  verificarToken,
  uploadDocumento,
  submeter,
  listarTokens,
  buscarCredenciais,
} = require('../controllers/onboardingController');

// Multer em memória (envia direto para Supabase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB por arquivo
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── Rotas públicas (sem auth) ──
router.get('/:token/info',             verificarToken);
router.post('/:token/upload',          upload.single('file'), uploadDocumento);
router.post('/:token/submeter',        submeter);

// ── Rotas protegidas (requer login no Hub) ──
router.post('/gerar',                  autenticar, gerarToken);
router.get('/tokens',                  autenticar, listarTokens);
router.get('/credenciais/:cliente_id', autenticar, buscarCredenciais);

module.exports = router;
