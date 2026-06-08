const express     = require('express');
const router      = express.Router();
const multer      = require('multer');
const { createClient } = require('@supabase/supabase-js');
const db          = require('../database/db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function supabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Nível 5 = máximo (sócio), 1 = mínimo (todos)
const NIVEL = { socio: 5, assistente: 4, sdr: 3, assistente_junior: 2, todos: 1 };
const PAPEL = { socio_fundador: 5, admin: 5, assistente: 4, diretor_comercial: 3, assistente_junior: 2, cliente: 1 };

function temAcesso(role, acessoMinimo) {
  return (PAPEL[role] || 0) >= (NIVEL[acessoMinimo] || 0);
}

// GET /documentos
router.get('/', async (req, res) => {
  try {
    const { categoria } = req.query;
    const vals = [];
    let where = `WHERE ativo = true`;
    if (categoria) { vals.push(categoria); where += ` AND categoria = $${vals.length}`; }

    const { rows } = await db.query(
      `SELECT * FROM documentos_internos ${where} ORDER BY created_at DESC`,
      vals,
    );

    const role = req.usuario?.role || 'assistente_junior';
    const filtrado = rows.filter(d => temAcesso(role, d.acesso_minimo));
    return res.json(filtrado);
  } catch (e) {
    console.error('[Docs] listar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// POST /documentos
router.post('/', upload.single('arquivo'), async (req, res) => {
  try {
    const role = req.usuario?.role || 'assistente_junior';
    if (!['socio_fundador', 'admin', 'assistente'].includes(role)) {
      return res.status(403).json({ erro: 'Sem permissão para fazer upload' });
    }

    const { nome, descricao, categoria, acesso_minimo } = req.body;
    if (!nome?.trim() || !categoria) return res.status(400).json({ erro: 'nome e categoria são obrigatórios' });

    let url_arquivo  = req.body.url_arquivo || null;
    let tipo_arquivo = req.body.tipo_arquivo || 'link';
    let tamanho_bytes = null;

    if (req.file) {
      const sb = supabaseClient();
      if (!sb) return res.status(500).json({ erro: 'Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY)' });

      const ext      = req.file.originalname.split('.').pop().toLowerCase();
      const fileName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const { error: upErr } = await sb.storage
        .from('documentos-internos')
        .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = sb.storage.from('documentos-internos').getPublicUrl(fileName);
      url_arquivo   = publicUrl;
      tipo_arquivo  = ext;
      tamanho_bytes = req.file.size;
    }

    const { rows: [doc] } = await db.query(
      `INSERT INTO documentos_internos
         (nome, descricao, categoria, acesso_minimo, url_arquivo, tipo_arquivo, tamanho_bytes, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        nome.trim(), descricao || null, categoria, acesso_minimo || 'assistente',
        url_arquivo, tipo_arquivo, tamanho_bytes,
        req.usuario?.nome || req.usuario?.email || 'Admin',
      ],
    );
    return res.json(doc);
  } catch (e) {
    console.error('[Docs] criar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// DELETE /documentos/:id
router.delete('/:id', async (req, res) => {
  try {
    const role = req.usuario?.role || '';
    if (!['socio_fundador', 'admin'].includes(role)) {
      return res.status(403).json({ erro: 'Somente sócios podem excluir documentos' });
    }
    await db.query(
      `UPDATE documentos_internos SET ativo=false, updated_at=NOW() WHERE id=$1`,
      [req.params.id],
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Docs] remover:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
