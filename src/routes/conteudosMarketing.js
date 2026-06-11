'use strict';
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const ctrl    = require('../controllers/conteudosMarketingController');

const uploadDir = path.join(__dirname, '../../public/uploads/marketing');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => {
      const u = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, u + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /\.(jpg|jpeg|png|gif|mp4|mov|avi|pdf)$/i.test(file.originalname));
  },
});

router.get('/',             ctrl.listar);
router.post('/',            upload.single('midia'), ctrl.criar);
router.put('/:id',          upload.single('midia'), ctrl.atualizar);
router.patch('/:id/status', ctrl.atualizarStatus);
router.delete('/:id',       ctrl.excluir);

module.exports = router;
