const express  = require('express');
const multer   = require('multer');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const db       = require('../database/db');
const autenticar = require('../middleware/autenticar');

const router = express.Router();

const TIPOS = [
  { key: 'contrato_social',           label: 'Contrato Social / Cartão CNPJ' },
  { key: 'certidao_federal',          label: 'Certidão Negativa Federal' },
  { key: 'certidao_estadual',         label: 'Certidão Negativa Estadual' },
  { key: 'certidao_municipal',        label: 'Certidão Negativa Municipal' },
  { key: 'atestado_capacidade_tecnica', label: 'Atestado de Capacidade Técnica' },
  { key: 'balanco_patrimonial',       label: 'Balanço Patrimonial' },
  { key: 'rg_socio',                  label: 'RG dos Sócios' },
  { key: 'cpf_socio',                 label: 'CPF dos Sócios' },
  { key: 'logo_empresa',              label: 'Logo da Empresa (PNG)' },
];

// ─── Upload storage ──────────────────────────────────────────────────────────
function criarStorage(clienteId) {
  const dest = path.join(__dirname, '..', '..', 'uploads', 'documentos', String(clienteId));
  fs.mkdirSync(dest, { recursive: true });
  return multer.diskStorage({
    destination: dest,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });
}

// ─── ROTAS PÚBLICAS ──────────────────────────────────────────────────────────

// GET /documentos-cliente/upload/:token → página do cliente
router.get('/upload/:token', async (req, res) => {
  try {
    const { rows: [tok] } = await db.query(
      `SELECT t.*, c.nome AS cliente_nome, c.razao_social
       FROM tokens_upload t
       JOIN clientes c ON c.id = t.cliente_id
       WHERE t.token = $1`,
      [req.params.token],
    );
    if (!tok) return res.status(404).json({ erro: 'Link inválido' });
    if (new Date(tok.expira_em) < new Date()) return res.status(410).json({ erro: 'Link expirado' });

    const { rows: docs } = await db.query(
      `SELECT * FROM documentos_cliente WHERE cliente_id = $1 ORDER BY id`,
      [tok.cliente_id],
    );
    return res.json({ ok: true, cliente: { nome: tok.razao_social || tok.cliente_nome }, documentos: docs });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

// POST /documentos-cliente/upload/:token → envio de arquivo pelo cliente
router.post('/upload/:token', async (req, res) => {
  try {
    const { rows: [tok] } = await db.query(
      `SELECT * FROM tokens_upload WHERE token = $1`,
      [req.params.token],
    );
    if (!tok) return res.status(404).json({ erro: 'Link inválido' });
    if (new Date(tok.expira_em) < new Date()) return res.status(410).json({ erro: 'Link expirado' });

    const upload = multer({
      storage: criarStorage(tok.cliente_id),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, f, cb) => {
        const ok = ['application/pdf', 'image/jpeg', 'image/png'].includes(f.mimetype);
        cb(ok ? null : new Error('Tipo não permitido'), ok);
      },
    }).single('arquivo');

    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ erro: err.message });
      if (!req.file) return res.status(400).json({ erro: 'Arquivo não enviado' });

      const tipo = req.body.tipo;
      if (!tipo) return res.status(400).json({ erro: 'tipo é obrigatório' });

      // Salvar logo em base64 no cliente se for logo_empresa
      if (tipo === 'logo_empresa') {
        const base64 = fs.readFileSync(req.file.path).toString('base64');
        const mime = req.file.mimetype;
        await db.query(
          `UPDATE clientes SET logo_base64 = $1 WHERE id = $2`,
          [`data:${mime};base64,${base64}`, tok.cliente_id],
        );
      }

      const { rows: [doc] } = await db.query(
        `UPDATE documentos_cliente
         SET status='enviado', nome_arquivo=$1, caminho_arquivo=$2, enviado_em=NOW(), updated_at=NOW()
         WHERE cliente_id=$3 AND tipo=$4
         RETURNING *`,
        [req.file.originalname, req.file.path, tok.cliente_id, tipo],
      );

      if (!doc) {
        // Criou doc se não existia
        const { rows: [novo] } = await db.query(
          `INSERT INTO documentos_cliente (cliente_id, tipo, nome_arquivo, caminho_arquivo, status, enviado_em)
           VALUES ($1,$2,$3,$4,'enviado',NOW()) RETURNING *`,
          [tok.cliente_id, tipo, req.file.originalname, req.file.path],
        );
        return res.json({ sucesso: true, tipo, status: 'enviado', doc: novo });
      }

      return res.json({ sucesso: true, tipo, status: 'enviado', doc });
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

// ─── ROTAS PROTEGIDAS ────────────────────────────────────────────────────────

// POST /documentos-cliente/gerar-link/:clienteId
router.post('/gerar-link/:clienteId', autenticar, async (req, res) => {
  const { clienteId } = req.params;
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const expiraEm = new Date(Date.now() + 30 * 24 * 3600 * 1000);

    await db.query(
      `INSERT INTO tokens_upload (cliente_id, token, expira_em) VALUES ($1,$2,$3)`,
      [clienteId, token, expiraEm],
    );

    // Criar documentos_cliente para cada tipo se não existir
    for (const t of TIPOS) {
      await db.query(
        `INSERT INTO documentos_cliente (cliente_id, tipo, token_upload, status)
         VALUES ($1,$2,$3,'pendente')
         ON CONFLICT DO NOTHING`,
        [clienteId, t.key, token],
      ).catch(() => {}); // sem unique constraint composta — ignora duplicado
    }

    const baseUrl = process.env.HUB_BASE_URL || 'https://hub.conlicit.com';
    const link = `${baseUrl}/envio-documentos?token=${token}`;
    return res.json({ sucesso: true, token, link, expira_em: expiraEm });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

// GET /documentos-cliente/cliente/:clienteId
router.get('/cliente/:clienteId', autenticar, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM documentos_cliente WHERE cliente_id = $1 ORDER BY id`,
      [req.params.clienteId],
    );
    const total = TIPOS.length;
    const enviados = rows.filter(d => ['enviado','aprovado'].includes(d.status)).length;
    return res.json({ sucesso: true, dados: rows, resumo: { enviados, total } });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

// PATCH /documentos-cliente/:id/status
router.patch('/:id/status', autenticar, async (req, res) => {
  const { status, observacoes } = req.body ?? {};
  if (!['aprovado','rejeitado'].includes(status)) return res.status(400).json({ erro: 'status inválido' });
  try {
    const { rows: [d] } = await db.query(
      `UPDATE documentos_cliente SET status=$1, observacoes=$2, updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [status, observacoes || null, req.params.id],
    );
    if (!d) return res.status(404).json({ erro: 'Documento não encontrado' });
    return res.json({ sucesso: true, dados: d });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

// GET /documentos-cliente/vencimentos?dias=30
router.get('/vencimentos', autenticar, async (req, res) => {
  const dias = parseInt(req.query.dias || '30', 10);
  try {
    const { rows } = await db.query(
      `SELECT dc.*, c.nome AS cliente_nome
       FROM documentos_cliente dc
       JOIN clientes c ON c.id = dc.cliente_id
       WHERE dc.data_vencimento IS NOT NULL
         AND dc.data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${dias} days'
       ORDER BY dc.data_vencimento`,
    );
    return res.json({ sucesso: true, dados: rows });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

// PATCH /documentos-cliente/:id/vencimento
router.patch('/:id/vencimento', autenticar, async (req, res) => {
  const { data_vencimento } = req.body ?? {};
  try {
    const { rows: [d] } = await db.query(
      `UPDATE documentos_cliente SET data_vencimento=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [data_vencimento || null, req.params.id],
    );
    if (!d) return res.status(404).json({ erro: 'Documento não encontrado' });
    return res.json({ sucesso: true, dados: d });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
