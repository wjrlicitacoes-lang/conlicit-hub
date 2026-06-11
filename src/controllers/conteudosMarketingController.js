'use strict';
const db = require('../database/db');

async function listar(req, res) {
  try {
    const { canal, status, mes, ano } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (canal)  { params.push(canal);          where += ` AND mc.canal = $${params.length}`; }
    if (status) { params.push(status);          where += ` AND mc.status = $${params.length}`; }
    if (mes)    { params.push(parseInt(mes));   where += ` AND EXTRACT(MONTH FROM mc.data_publicacao) = $${params.length}`; }
    if (ano)    { params.push(parseInt(ano));   where += ` AND EXTRACT(YEAR FROM mc.data_publicacao)  = $${params.length}`; }

    const { rows } = await db.query(
      `SELECT mc.*, u.nome AS criado_por_nome
       FROM marketing_conteudos mc
       LEFT JOIN usuarios u ON mc.criado_por = u.id
       ${where}
       ORDER BY mc.data_publicacao ASC, mc.criado_em DESC`,
      params,
    );
    return res.json(rows);
  } catch (err) {
    console.error('[MktConteudos] listar:', err.message);
    return res.status(500).json({ erro: 'Erro ao buscar conteúdos' });
  }
}

async function criar(req, res) {
  try {
    const { canal, data_publicacao, tipo_conteudo, titulo, texto_midia, legenda, hashtags, status } = req.body;
    const url_midia    = req.file ? `/uploads/marketing/${req.file.filename}` : null;
    const nome_arquivo = req.file ? req.file.originalname : null;

    const { rows } = await db.query(
      `INSERT INTO marketing_conteudos
         (canal, data_publicacao, tipo_conteudo, titulo, texto_midia,
          legenda, hashtags, status, url_midia, nome_arquivo, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [canal, data_publicacao, tipo_conteudo || null, titulo || null, texto_midia || null,
       legenda || null, hashtags || null, status || 'rascunho',
       url_midia, nome_arquivo, req.usuario?.id || null],
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[MktConteudos] criar:', err.message);
    return res.status(500).json({ erro: 'Erro ao criar conteúdo' });
  }
}

async function atualizar(req, res) {
  try {
    const { id } = req.params;
    const { canal, data_publicacao, tipo_conteudo, titulo, texto_midia, legenda, hashtags, status } = req.body;

    const fields = [canal, data_publicacao, tipo_conteudo || null, titulo || null,
                    texto_midia || null, legenda || null, hashtags || null, status];
    let query = `UPDATE marketing_conteudos SET
      canal=$1, data_publicacao=$2, tipo_conteudo=$3, titulo=$4,
      texto_midia=$5, legenda=$6, hashtags=$7, status=$8, atualizado_em=NOW()`;

    if (req.file) {
      fields.push(`/uploads/marketing/${req.file.filename}`, req.file.originalname);
      query += `, url_midia=$${fields.length - 1}, nome_arquivo=$${fields.length}`;
    }
    fields.push(id);
    query += ` WHERE id=$${fields.length} RETURNING *`;

    const { rows } = await db.query(query, fields);
    if (!rows.length) return res.status(404).json({ erro: 'Conteúdo não encontrado' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[MktConteudos] atualizar:', err.message);
    return res.status(500).json({ erro: 'Erro ao atualizar conteúdo' });
  }
}

async function atualizarStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { rows } = await db.query(
      `UPDATE marketing_conteudos SET status=$1, atualizado_em=NOW() WHERE id=$2 RETURNING *`,
      [status, id],
    );
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao atualizar status' });
  }
}

async function excluir(req, res) {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM marketing_conteudos WHERE id=$1', [id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao excluir' });
  }
}

module.exports = { listar, criar, atualizar, atualizarStatus, excluir };
