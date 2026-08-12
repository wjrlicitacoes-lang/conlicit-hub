const crypto = require('crypto');
const multer = require('multer');
const db = require('../database/db');
const { createClient } = require('@supabase/supabase-js');
const { analisarPDF } = require('../services/edsonService');

function supabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const uploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const TIPOS_VALIDOS = ['edital', 'planilha', 'proposta', 'complementar', 'imagem_pncp'];
const CACHE_HORAS = 12;

async function listar(req, res) {
  const { pid } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM pregao_documentos WHERE pregao_id = $1 ORDER BY criado_em DESC`,
      [pid],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[PregaoDocs] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// Reaproveita analisarPDF do Edson (mesmo fluxo do upload em /edson/:pregao_id/upload-pdf),
// pulando o disparo se o mesmo PDF (por hash) já foi analisado com sucesso nas últimas 12h.
async function dispararEdsonSeNecessario(pregaoId, hashAtual, buffer) {
  const { rows: [uploadAnterior] } = await db.query(
    `SELECT sha256_hash FROM pregao_documentos
      WHERE pregao_id = $1 AND tipo = 'edital'
      ORDER BY criado_em DESC OFFSET 1 LIMIT 1`,
    [pregaoId],
  );
  const { rows: [analise] } = await db.query(
    `SELECT id, status, atualizado_em FROM analises_edson WHERE pregao_id = $1`,
    [pregaoId],
  );

  const cacheValido = uploadAnterior?.sha256_hash === hashAtual
    && analise?.status === 'concluido'
    && analise.atualizado_em
    && (Date.now() - new Date(analise.atualizado_em).getTime()) < CACHE_HORAS * 3600 * 1000;

  if (cacheValido) {
    return { reaproveitada: true, analise_id: analise.id, status: analise.status };
  }

  const { rows: [novaAnalise] } = await db.query(
    `INSERT INTO analises_edson (pregao_id, status)
     VALUES ($1, 'processando')
     ON CONFLICT (pregao_id) DO UPDATE SET
       status = 'processando', score = NULL, score_justificativa = NULL,
       resumo_executivo = NULL, modalidade = NULL, modo_disputa = NULL,
       tipo_julgamento = NULL, itens = '[]', habilitacao = '[]',
       riscos = '[]', checklist = '{"antes":[],"durante":[]}',
       criterios_score = NULL, erro_mensagem = NULL, atualizado_em = NOW()
     RETURNING id`,
    [pregaoId],
  );
  analisarPDF(novaAnalise.id, parseInt(pregaoId, 10), buffer, 'reuniao').catch(console.error);
  return { reaproveitada: false, analise_id: novaAnalise.id, status: 'processando' };
}

// Sobe o arquivo pro bucket pregoes-docs e grava a linha em pregao_documentos.
// Reaproveitada tanto pelo endpoint de upload avulso quanto pela criação de pregão
// com edital anexado (POST /clientes/:id/pregoes, campo edital_pdf).
async function salvarDocumento(pregaoId, tipo, file, usuarioId) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase não configurado');

  const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const nomeSanitizado = file.originalname.replace(/[^\w.\-]/g, '_');
  const fileName = `${pregaoId}/${tipo}/${Date.now()}_${nomeSanitizado}`;

  const { error: upErr } = await sb.storage
    .from('pregoes-docs')
    .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });
  if (upErr) throw upErr;

  const { data: { publicUrl } } = sb.storage.from('pregoes-docs').getPublicUrl(fileName);

  const { rows: [doc] } = await db.query(
    `INSERT INTO pregao_documentos (pregao_id, tipo, nome_arquivo, url_arquivo, tamanho_bytes, sha256_hash, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [pregaoId, tipo, file.originalname, publicUrl, file.size, hash, usuarioId || null],
  );
  return { doc, hash };
}

async function upload(req, res) {
  const { pid } = req.params;
  const { tipo } = req.body ?? {};
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ erro: `tipo inválido (use: ${TIPOS_VALIDOS.join(', ')})` });
  }

  try {
    const { rows: [pregao] } = await db.query('SELECT id FROM pregoes WHERE id = $1', [pid]);
    if (!pregao) return res.status(404).json({ erro: 'Pregão não encontrado' });

    const { doc, hash } = await salvarDocumento(pid, tipo, req.file, req.usuario?.id);

    const analiseInfo = tipo === 'edital'
      ? await dispararEdsonSeNecessario(pid, hash, req.file.buffer)
      : null;

    return res.status(201).json({ documento: doc, analise: analiseInfo });
  } catch (e) {
    console.error('[PregaoDocs] upload:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

async function remover(req, res) {
  const { pid, docId } = req.params;
  try {
    const { rows: [doc] } = await db.query(
      `SELECT url_arquivo FROM pregao_documentos WHERE id = $1 AND pregao_id = $2`,
      [docId, pid],
    );
    if (!doc) return res.status(404).json({ erro: 'Documento não encontrado' });

    await db.query(`DELETE FROM pregao_documentos WHERE id = $1 AND pregao_id = $2`, [docId, pid]);

    const sb = supabase();
    if (sb) {
      const partes = doc.url_arquivo.split('/pregoes-docs/');
      const caminho = partes[1] && decodeURIComponent(partes[1]);
      if (caminho) await sb.storage.from('pregoes-docs').remove([caminho]).catch(() => {});
    }
    return res.json({ mensagem: 'Documento removido' });
  } catch (e) {
    console.error('[PregaoDocs] remover:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listar, upload, remover, uploadMulter, salvarDocumento, dispararEdsonSeNecessario };
