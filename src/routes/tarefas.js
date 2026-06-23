const router = require('express').Router();
const db     = require('../database/db');
const auth   = require('../middleware/autenticar');

const ROLES_GESTOR = ['admin', 'socio_fundador'];

// ── GET /tarefas — tarefas do usuário logado (para funcionários / Minha Área)
router.get('/', auth, async (req, res) => {
  try {
    const { id, role } = req.usuario;
    const { rows } = await db.query(
      `SELECT t.*, c.nome AS cliente_nome,
              u.nome AS responsavel_nome,
              cr.nome AS criado_por_nome
       FROM tarefas_internas t
       LEFT JOIN clientes c    ON c.id = t.cliente_id
       LEFT JOIN usuarios u    ON u.id = t.atribuido_para_usuario_id
       LEFT JOIN usuarios cr   ON cr.id = t.criado_por
       WHERE t.atribuido_para_usuario_id = $1
          OR (t.atribuido_para_role = $2 AND t.atribuido_para_usuario_id IS NULL)
       ORDER BY
         CASE t.prioridade WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         t.prazo ASC NULLS LAST,
         t.criado_em ASC`,
      [id, role],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Tarefas] GET:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── GET /tarefas/todas — visão gestora (todas as tarefas)
router.get('/todas', auth, async (req, res) => {
  if (!ROLES_GESTOR.includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  try {
    const { status, usuario_id, cliente_id, prioridade } = req.query;
    const conds  = [];
    const params = [];
    let i = 1;

    if (status)     { conds.push(`t.status = $${i++}`);     params.push(status); }
    if (usuario_id) { conds.push(`t.atribuido_para_usuario_id = $${i++}`); params.push(Number(usuario_id)); }
    if (cliente_id) { conds.push(`t.cliente_id = $${i++}`); params.push(Number(cliente_id)); }
    if (prioridade) { conds.push(`t.prioridade = $${i++}`); params.push(prioridade); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT t.*,
              c.nome  AS cliente_nome,
              u.nome  AS responsavel_nome,
              u.role  AS responsavel_role,
              cr.nome AS criado_por_nome
       FROM tarefas_internas t
       LEFT JOIN clientes c  ON c.id = t.cliente_id
       LEFT JOIN usuarios u  ON u.id = t.atribuido_para_usuario_id
       LEFT JOIN usuarios cr ON cr.id = t.criado_por
       ${where}
       ORDER BY
         CASE t.status WHEN 'pendente' THEN 1 WHEN 'em_andamento' THEN 2 ELSE 3 END,
         CASE t.prioridade WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         t.prazo ASC NULLS LAST,
         t.criado_em DESC`,
      params,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Tarefas] GET /todas:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── GET /tarefas/stats — resumo por responsável (para gestores)
router.get('/stats', auth, async (req, res) => {
  if (!ROLES_GESTOR.includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  try {
    const { rows } = await db.query(
      `SELECT
         COALESCE(u.nome, t.atribuido_para_role, 'Sem responsável') AS responsavel,
         t.atribuido_para_usuario_id,
         COUNT(*) FILTER (WHERE t.status = 'pendente')     AS pendentes,
         COUNT(*) FILTER (WHERE t.status = 'em_andamento') AS em_andamento,
         COUNT(*) FILTER (WHERE t.status = 'concluido')    AS concluidas,
         COUNT(*) FILTER (WHERE t.prioridade IN ('alta','urgente') AND t.status != 'concluido') AS urgentes,
         COUNT(*) AS total
       FROM tarefas_internas t
       LEFT JOIN usuarios u ON u.id = t.atribuido_para_usuario_id
       GROUP BY u.nome, t.atribuido_para_usuario_id, t.atribuido_para_role
       ORDER BY pendentes DESC`,
    );
    return res.json({ dados: rows });
  } catch (e) {
    console.error('[Tarefas] GET /stats:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── POST /tarefas — criar tarefa (gestores)
router.post('/', auth, async (req, res) => {
  if (!ROLES_GESTOR.includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  const {
    titulo, descricao, tipo, prioridade,
    atribuido_para_usuario_id, atribuido_para_role,
    cliente_id, oportunidade_id, prazo,
  } = req.body;

  if (!titulo) return res.status(400).json({ erro: 'Título é obrigatório' });
  if (!atribuido_para_usuario_id && !atribuido_para_role)
    return res.status(400).json({ erro: 'Informe o responsável (usuário ou role)' });

  try {
    const { rows: [tarefa] } = await db.query(
      `INSERT INTO tarefas_internas
         (titulo, descricao, tipo, prioridade,
          atribuido_para_usuario_id, atribuido_para_role,
          cliente_id, oportunidade_id, prazo, criado_por, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendente')
       RETURNING *`,
      [
        titulo,
        descricao || null,
        tipo || null,
        prioridade || 'normal',
        atribuido_para_usuario_id ? Number(atribuido_para_usuario_id) : null,
        atribuido_para_role || null,
        cliente_id ? Number(cliente_id) : null,
        oportunidade_id || null,
        prazo || null,
        req.usuario.id,
      ],
    );
    return res.status(201).json(tarefa);
  } catch (e) {
    console.error('[Tarefas] POST:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// ── PATCH /tarefas/:id/status — atualizar status
router.patch('/:id/status', auth, async (req, res) => {
  const { status, url_resultado } = req.body ?? {};
  const statusValidos = ['pendente', 'em_andamento', 'concluido'];
  if (!statusValidos.includes(status))
    return res.status(400).json({ erro: `Status inválido. Use: ${statusValidos.join(', ')}` });

  try {
    const campos  = ['status = $2'];
    const valores = [req.params.id, status];

    if (url_resultado !== undefined) {
      campos.push(`url_resultado = $${valores.length + 1}`);
      valores.push(url_resultado);
    }
    if (status === 'concluido') {
      campos.push(`concluido_em = now()`);
    } else {
      campos.push(`concluido_em = NULL`);
    }

    const { rows } = await db.query(
      `UPDATE tarefas_internas SET ${campos.join(', ')} WHERE id = $1 RETURNING *`,
      valores,
    );
    if (!rows.length) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    return res.json(rows[0]);
  } catch (e) {
    console.error('[Tarefas] PATCH status:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── DELETE /tarefas/:id — excluir tarefa (gestores)
router.delete('/:id', auth, async (req, res) => {
  if (!ROLES_GESTOR.includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  try {
    const { rowCount } = await db.query(
      'DELETE FROM tarefas_internas WHERE id = $1', [req.params.id],
    );
    if (!rowCount) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Tarefas] DELETE:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
