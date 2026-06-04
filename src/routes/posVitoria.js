const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const router   = express.Router();
const db       = require('../database/posVitoriaDB');

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'notas-fiscais');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf','image/jpeg','image/png'].includes(file.mimetype);
    cb(ok ? null : new Error('Somente PDF, JPEG e PNG'), ok);
  },
});

function ok(res, data, status = 200) { return res.status(status).json({ sucesso: true, dados: data }); }
function erro(res, msg, status = 400) { return res.status(status).json({ sucesso: false, erro: msg }); }
function cap(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

router.get('/kpis', cap(async (req, res) => { ok(res, await db.buscarKPIs()); }));

router.get('/contratos', cap(async (req, res) => {
  ok(res, await db.listarContratos({ status: req.query.status, cliente_nome: req.query.cliente_nome }));
}));
router.get('/contratos/:id', cap(async (req, res) => {
  const c = await db.buscarContrato(req.params.id);
  if (!c) return erro(res, 'Contrato não encontrado', 404);
  ok(res, c);
}));
router.post('/contratos', cap(async (req, res) => {
  const faltando = ['cliente_nome','modalidade','numero_pregao','orgao','valor_contrato','percentual_comissao','data_vitoria'].filter(c => !req.body[c]);
  if (faltando.length) return erro(res, `Campos obrigatórios: ${faltando.join(', ')}`);
  ok(res, await db.criarContrato(req.body), 201);
}));
router.patch('/contratos/:id', cap(async (req, res) => {
  const c = await db.atualizarContrato(req.params.id, req.body);
  if (!c) return erro(res, 'Contrato não encontrado', 404);
  ok(res, c);
}));
router.patch('/contratos/:id/status', cap(async (req, res) => {
  const validos = ['assinando','ativo','aguardando_nf','concluido','rescindido'];
  if (!validos.includes(req.body.status)) return erro(res, `Status inválido. Use: ${validos.join(', ')}`);
  const c = await db.atualizarContrato(req.params.id, { status: req.body.status });
  if (!c) return erro(res, 'Contrato não encontrado', 404);
  ok(res, c);
}));

router.get('/notas-fiscais', cap(async (req, res) => {
  ok(res, await db.listarNotasFiscais(
    req.query.contrato_id ? parseInt(req.query.contrato_id) : null,
    req.query.status_cobranca || null
  ));
}));
router.get('/contratos/:id/notas-fiscais', cap(async (req, res) => {
  ok(res, await db.listarNotasFiscais(parseInt(req.params.id)));
}));
router.post('/notas-fiscais', upload.single('arquivo_nf'), cap(async (req, res) => {
  const faltando = ['contrato_id','numero_nf','data_emissao','valor_nf','percentual_aplicado'].filter(c => !req.body[c]);
  if (faltando.length) return erro(res, `Campos obrigatórios: ${faltando.join(', ')}`);
  const nf = await db.criarNotaFiscal({
    ...req.body,
    contrato_id: parseInt(req.body.contrato_id),
    valor_nf: parseFloat(req.body.valor_nf),
    percentual_aplicado: parseFloat(req.body.percentual_aplicado),
    arquivo_nf_url: req.file ? `/uploads/notas-fiscais/${req.file.filename}` : null,
  });
  ok(res, nf, 201);
}));
router.patch('/notas-fiscais/:id/status', cap(async (req, res) => {
  const validos = ['pendente','cobranca_enviada','recebido','atrasado','negociando'];
  if (!validos.includes(req.body.status_cobranca)) return erro(res, `Status inválido. Use: ${validos.join(', ')}`);
  const nf = await db.atualizarStatusNF(req.params.id, req.body.status_cobranca);
  if (!nf) return erro(res, 'Nota fiscal não encontrada', 404);
  ok(res, nf);
}));

router.get('/comissoes', cap(async (req, res) => {
  ok(res, await db.listarComissoes({
    status: req.query.status || null,
    contrato_id: req.query.contrato_id ? parseInt(req.query.contrato_id) : null,
  }));
}));
router.get('/contratos/:id/comissoes', cap(async (req, res) => {
  ok(res, await db.listarComissoes({ contrato_id: parseInt(req.params.id) }));
}));
router.post('/comissoes/:id/recebimento', cap(async (req, res) => {
  const validos = ['pendente','enviada','recebida','atrasada','negociando','cancelada'];
  if (!validos.includes(req.body.status)) return erro(res, `Status inválido. Use: ${validos.join(', ')}`);
  if (req.body.status === 'recebida' && (!req.body.valor_recebido || !req.body.data_recebimento)) {
    return erro(res, 'Para status recebida informe valor_recebido e data_recebimento');
  }
  ok(res, await db.registrarRecebimento(req.params.id, req.body));
}));

router.use((err, req, res, next) => {
  console.error('[pos-vitoria]', err.message);
  if (err.code === '23505') return erro(res, 'Registro duplicado', 409);
  if (err.code === '23503') return erro(res, 'Registro relacionado não encontrado', 404);
  erro(res, err.message || 'Erro interno', 500);
});

module.exports = router;
