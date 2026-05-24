const db = require('../database/db');

async function listar(req, res) {
  if (req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Acesso negado' });
  try {
    const { rows } = await db.query(
      `SELECT * FROM prospects ORDER BY created_at DESC`,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Prospects] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criar(req, res) {
  if (req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Acesso negado' });
  const { nome, email, whatsapp, empresa, segmento, status, notas, responsavel } = req.body ?? {};
  if (!nome?.trim()) return res.status(400).json({ erro: 'nome é obrigatório' });
  try {
    const { rows: [p] } = await db.query(
      `INSERT INTO prospects (nome, email, whatsapp, empresa, segmento, status, notas, responsavel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [nome.trim(), email||null, whatsapp||null, empresa||null, segmento||null,
       status||'em_negociacao', notas||null, responsavel||null],
    );
    return res.status(201).json(p);
  } catch (e) {
    console.error('[Prospects] criar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizar(req, res) {
  if (req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Acesso negado' });
  const { id } = req.params;
  const { nome, email, whatsapp, empresa, segmento, status, notas, responsavel } = req.body ?? {};
  try {
    const { rows } = await db.query(
      `UPDATE prospects SET
         nome=$1, email=$2, whatsapp=$3, empresa=$4, segmento=$5,
         status=$6, notas=$7, responsavel=$8
       WHERE id=$9 RETURNING *`,
      [nome, email||null, whatsapp||null, empresa||null, segmento||null,
       status||'em_negociacao', notas||null, responsavel||null, id],
    );
    if (!rows.length) return res.status(404).json({ erro: 'Prospect não encontrado' });
    return res.json(rows[0]);
  } catch (e) {
    console.error('[Prospects] atualizar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listar, criar, atualizar };
