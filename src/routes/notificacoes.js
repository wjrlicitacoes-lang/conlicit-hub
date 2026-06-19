const router = require('express').Router();
const db = require('../database/db');

// GET /notificacoes — não lidas do usuário ou do role
router.get('/', async (req, res) => {
  try {
    const { id, role } = req.usuario;
    const { rows } = await db.query(
      `SELECT * FROM notificacoes
       WHERE (usuario_id = $1 OR role_destino = $2) AND lida = false
       ORDER BY criado_em DESC`,
      [id, role],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Notificacoes] GET:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// PATCH /notificacoes/:id/lida
router.patch('/:id/lida', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'UPDATE notificacoes SET lida=true WHERE id=$1',
      [req.params.id],
    );
    if (rowCount === 0) return res.status(404).json({ erro: 'Notificação não encontrada' });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// PATCH /notificacoes/lidas-todas
router.patch('/lidas-todas', async (req, res) => {
  try {
    const { id, role } = req.usuario;
    await db.query(
      'UPDATE notificacoes SET lida=true WHERE (usuario_id=$1 OR role_destino=$2) AND lida=false',
      [id, role],
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
