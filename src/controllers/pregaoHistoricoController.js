const db = require('../database/db');

async function listar(req, res) {
  const { pid } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT h.*, u.nome AS alterado_por_nome
       FROM pregao_historico_status h
       LEFT JOIN usuarios u ON u.id = h.alterado_por
       WHERE h.pregao_id = $1
       ORDER BY h.alterado_em DESC`,
      [pid],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[PregaoHistorico] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listar };
