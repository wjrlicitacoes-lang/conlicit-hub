const db = require('../database/db');

async function listar(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM documentos WHERE cliente_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (erro) {
    console.error('Erro ao listar documentos:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criar(req, res) {
  const { id } = req.params;
  const { nome, tipo, url, data_vencimento } = req.body ?? {};

  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });

  try {
    const { rows } = await db.query(
      `INSERT INTO documentos (cliente_id, nome, tipo, url, data_vencimento)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, nome.trim(), tipo || 'outro', url || null, data_vencimento || null],
    );
    return res.status(201).json(rows[0]);
  } catch (erro) {
    console.error('Erro ao criar documento:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function remover(req, res) {
  const { id, did } = req.params;
  try {
    const { rowCount } = await db.query(
      `DELETE FROM documentos WHERE id = $1 AND cliente_id = $2`,
      [did, id],
    );
    if (rowCount === 0) return res.status(404).json({ erro: 'Documento não encontrado' });
    return res.json({ mensagem: 'Documento removido' });
  } catch (erro) {
    console.error('Erro ao remover documento:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listar, criar, remover };
