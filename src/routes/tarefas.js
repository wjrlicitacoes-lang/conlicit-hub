const router = require('express').Router();
const db = require('../database/db');

// GET /tarefas — tarefas do usuário ou role
router.get('/', async (req, res) => {
  try {
    const { id, role } = req.usuario;
    const { rows } = await db.query(
      `SELECT t.*, c.nome AS cliente_nome FROM tarefas_internas t
       LEFT JOIN clientes c ON c.id = t.cliente_id
       WHERE t.atribuido_para_usuario_id = $1
          OR (t.atribuido_para_role = $2 AND t.atribuido_para_usuario_id IS NULL)
       ORDER BY t.criado_em ASC`,
      [id, role],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Tarefas] GET:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// PATCH /tarefas/:id/status
router.patch('/:id/status', async (req, res) => {
  const { status, url_resultado } = req.body ?? {};
  const statusValidos = ['pendente', 'em_andamento', 'concluido'];
  if (!statusValidos.includes(status))
    return res.status(400).json({ erro: `Status inválido. Use: ${statusValidos.join(', ')}` });

  try {
    const campos = ['status = $2'];
    const valores = [req.params.id, status];

    if (url_resultado !== undefined) {
      campos.push(`url_resultado = $${valores.length + 1}`);
      valores.push(url_resultado);
    }
    if (status === 'concluido') {
      campos.push(`concluido_em = now()`);
    }

    const { rows } = await db.query(
      `UPDATE tarefas_internas SET ${campos.join(', ')} WHERE id = $1 RETURNING *`,
      valores,
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    return res.json(rows[0]);
  } catch (e) {
    console.error('[Tarefas] PATCH:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
