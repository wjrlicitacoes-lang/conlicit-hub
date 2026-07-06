const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

const ROLES_ADMIN   = ['admin', 'socio_fundador'];
const ROLES_GESTOR  = ['admin', 'socio_fundador', 'operacional', 'comercial'];
const ROLES_EQUIPE  = ['admin', 'socio_fundador', 'operacional', 'comercial', 'assistente', 'assistente_junior'];

// ── GET /api/tarefas/kpis (admin only) ──
router.get('/kpis', async (req, res) => {
  if (!ROLES_ADMIN.includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  try {
    const { rows: [kpis] } = await db.query(`
      SELECT
        COUNT(*)                                           AS total,
        COUNT(*) FILTER (WHERE prioridade = 'urgente' AND status NOT IN ('concluida','cancelada')) AS urgentes,
        COUNT(*) FILTER (WHERE data_prazo < CURRENT_DATE  AND status NOT IN ('concluida','cancelada')) AS atrasadas,
        COUNT(*) FILTER (WHERE DATE(data_conclusao) = CURRENT_DATE) AS concluidas_hoje,
        COUNT(*) FILTER (WHERE status = 'a_fazer')       AS a_fazer,
        COUNT(*) FILTER (WHERE status = 'em_andamento')  AS em_andamento,
        COUNT(*) FILTER (WHERE status = 'aguardando')    AS aguardando,
        COUNT(*) FILTER (WHERE status = 'concluida')     AS concluida,
        COUNT(*) FILTER (WHERE status = 'cancelada')     AS cancelada
      FROM tarefas
    `);

    const { rows: porMembro } = await db.query(`
      SELECT
        u.nome, u.role,
        COUNT(t.id)                                           AS total,
        COUNT(t.id) FILTER (WHERE t.status = 'concluida')   AS concluidas,
        COUNT(t.id) FILTER (WHERE t.status = 'em_andamento')AS em_andamento,
        COUNT(t.id) FILTER (WHERE t.data_prazo < CURRENT_DATE AND t.status NOT IN ('concluida','cancelada')) AS atrasadas
      FROM usuarios u
      LEFT JOIN tarefas t ON t.responsavel_id = u.id
      WHERE u.role NOT IN ('cliente')
      GROUP BY u.id, u.nome, u.role
      HAVING COUNT(t.id) > 0
      ORDER BY COUNT(t.id) FILTER (WHERE t.status NOT IN ('concluida','cancelada')) DESC
    `);

    return res.json({
      total: Number(kpis.total),
      urgentes: Number(kpis.urgentes),
      atrasadas: Number(kpis.atrasadas),
      concluidas_hoje: Number(kpis.concluidas_hoje),
      por_status: {
        a_fazer: Number(kpis.a_fazer),
        em_andamento: Number(kpis.em_andamento),
        aguardando: Number(kpis.aguardando),
        concluida: Number(kpis.concluida),
        cancelada: Number(kpis.cancelada),
      },
      por_membro: porMembro,
    });
  } catch (e) {
    console.error('[tarefas] kpis:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── GET /api/tarefas ──
router.get('/', async (req, res) => {
  const { id, role } = req.usuario;
  const { status, prioridade, responsavel_id, categoria, de, ate, cliente_id } = req.query;

  const conds  = [];
  const params = [];
  let i = 1;

  // Admin vê todas; outros só as suas
  if (!ROLES_ADMIN.includes(role)) {
    conds.push(`t.responsavel_id = $${i++}`);
    params.push(id);
  } else if (responsavel_id) {
    conds.push(`t.responsavel_id = $${i++}`);
    params.push(Number(responsavel_id));
  }

  if (status)     { conds.push(`t.status = $${i++}`);     params.push(status); }
  if (prioridade) { conds.push(`t.prioridade = $${i++}`); params.push(prioridade); }
  if (categoria)  { conds.push(`t.categoria = $${i++}`);  params.push(categoria); }
  if (cliente_id) { conds.push(`t.cliente_id = $${i++}`); params.push(Number(cliente_id)); }
  if (de)         { conds.push(`t.data_prazo >= $${i++}`);params.push(de); }
  if (ate)        { conds.push(`t.data_prazo <= $${i++}`);params.push(ate); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  try {
    const { rows } = await db.query(`
      SELECT
        t.*,
        u.nome  AS responsavel_nome, u.role AS responsavel_role,
        cr.nome AS criado_por_nome,
        c.nome  AS cliente_nome
      FROM tarefas t
      LEFT JOIN usuarios u  ON u.id = t.responsavel_id
      LEFT JOIN usuarios cr ON cr.id = t.criado_por
      LEFT JOIN clientes c  ON c.id = t.cliente_id
      ${where}
      ORDER BY
        CASE t.prioridade WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
        t.data_prazo ASC NULLS LAST,
        t.created_at DESC
    `, params);

    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[tarefas] GET:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── GET /api/tarefas/:id ──
router.get('/:id', async (req, res) => {
  try {
    const { rows: [tarefa] } = await db.query(`
      SELECT
        t.*,
        u.nome  AS responsavel_nome, u.role AS responsavel_role,
        cr.nome AS criado_por_nome,
        c.nome  AS cliente_nome
      FROM tarefas t
      LEFT JOIN usuarios u  ON u.id = t.responsavel_id
      LEFT JOIN usuarios cr ON cr.id = t.criado_por
      LEFT JOIN clientes c  ON c.id = t.cliente_id
      WHERE t.id = $1
    `, [req.params.id]);

    if (!tarefa) return res.status(404).json({ erro: 'Tarefa não encontrada' });

    const { rows: comentarios } = await db.query(`
      SELECT tc.*, u.nome AS autor_nome
      FROM tarefa_comentarios tc
      LEFT JOIN usuarios u ON u.id = tc.usuario_id
      WHERE tc.tarefa_id = $1
      ORDER BY tc.created_at ASC
    `, [req.params.id]);

    const { rows: historico } = await db.query(`
      SELECT th.*, u.nome AS autor_nome
      FROM tarefa_historico th
      LEFT JOIN usuarios u ON u.id = th.usuario_id
      WHERE th.tarefa_id = $1
      ORDER BY th.created_at DESC
    `, [req.params.id]);

    return res.json({ ...tarefa, comentarios, historico });
  } catch (e) {
    console.error('[tarefas] GET/:id:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── POST /api/tarefas ──
router.post('/', async (req, res) => {
  const { id, role } = req.usuario;
  const { titulo, descricao, responsavel_id, cliente_id, pregao_id, data_prazo, prioridade, categoria } = req.body ?? {};

  if (!titulo) return res.status(400).json({ erro: 'Título é obrigatório' });
  if (!responsavel_id) return res.status(400).json({ erro: 'Responsável é obrigatório' });

  // Assistente só pode criar para si mesmo
  if (role === 'assistente' || role === 'assistente_junior') {
    if (String(responsavel_id) !== String(id))
      return res.status(403).json({ erro: 'Assistente só pode criar tarefas para si mesmo' });
  }

  try {
    const { rows: [tarefa] } = await db.query(`
      INSERT INTO tarefas
        (titulo, descricao, responsavel_id, cliente_id, pregao_id, data_prazo, prioridade, categoria, criado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      titulo,
      descricao || null,
      Number(responsavel_id),
      cliente_id ? Number(cliente_id) : null,
      pregao_id || null,
      data_prazo || null,
      prioridade || 'media',
      categoria || null,
      id,
    ]);
    return res.status(201).json(tarefa);
  } catch (e) {
    console.error('[tarefas] POST:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// ── PUT /api/tarefas/:id ──
router.put('/:id', async (req, res) => {
  const { id: userId, role } = req.usuario;
  const tarefaId = req.params.id;

  // Buscar tarefa atual para verificar permissão e registrar histórico
  const { rows: [current] } = await db.query(
    `SELECT * FROM tarefas WHERE id = $1`, [tarefaId],
  ).catch(() => ({ rows: [] }));

  if (!current) return res.status(404).json({ erro: 'Tarefa não encontrada' });

  const isAdmin = ROLES_ADMIN.includes(role);
  const isResponsavel = String(current.responsavel_id) === String(userId);

  if (!isAdmin && !isResponsavel)
    return res.status(403).json({ erro: 'Sem permissão para alterar esta tarefa' });

  const { titulo, descricao, status, prioridade, responsavel_id, cliente_id, pregao_id, data_prazo, categoria } = req.body ?? {};

  const campos  = ['updated_at = now()'];
  const params  = [tarefaId];
  let i = 2;

  if (isAdmin) {
    if (titulo !== undefined)        { campos.push(`titulo = $${i++}`);         params.push(titulo); }
    if (descricao !== undefined)     { campos.push(`descricao = $${i++}`);      params.push(descricao); }
    if (responsavel_id !== undefined){ campos.push(`responsavel_id = $${i++}`); params.push(Number(responsavel_id)); }
    if (cliente_id !== undefined)    { campos.push(`cliente_id = $${i++}`);     params.push(cliente_id ? Number(cliente_id) : null); }
    if (pregao_id !== undefined)     { campos.push(`pregao_id = $${i++}`);      params.push(pregao_id); }
    if (data_prazo !== undefined)    { campos.push(`data_prazo = $${i++}`);     params.push(data_prazo || null); }
    if (prioridade !== undefined)    { campos.push(`prioridade = $${i++}`);     params.push(prioridade); }
    if (categoria !== undefined)     { campos.push(`categoria = $${i++}`);      params.push(categoria); }
  }

  if (status !== undefined) {
    campos.push(`status = $${i++}`);
    params.push(status);
    if (status === 'concluida') {
      campos.push(`data_conclusao = now()`);
    } else {
      campos.push(`data_conclusao = NULL`);
    }
    // Registrar histórico de mudança de status
    await db.query(
      `INSERT INTO tarefa_historico (tarefa_id, usuario_id, campo_alterado, valor_anterior, valor_novo)
       VALUES ($1, $2, 'status', $3, $4)`,
      [tarefaId, userId, current.status, status],
    ).catch(() => {});
  }

  try {
    const { rows: [updated] } = await db.query(
      `UPDATE tarefas SET ${campos.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    return res.json(updated);
  } catch (e) {
    console.error('[tarefas] PUT:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// ── PATCH /api/tarefas/:id/status ──
router.patch('/:id/status', async (req, res) => {
  const { id: userId, role } = req.usuario;
  const { status } = req.body ?? {};

  const statusValidos = ['a_fazer', 'em_andamento', 'aguardando', 'concluida', 'cancelada'];
  if (!statusValidos.includes(status))
    return res.status(400).json({ erro: `Status inválido. Use: ${statusValidos.join(', ')}` });

  const { rows: [current] } = await db.query(
    `SELECT * FROM tarefas WHERE id = $1`, [req.params.id],
  ).catch(() => ({ rows: [] }));

  if (!current) return res.status(404).json({ erro: 'Tarefa não encontrada' });

  const isAdmin = ROLES_ADMIN.includes(role);
  if (!isAdmin && String(current.responsavel_id) !== String(userId))
    return res.status(403).json({ erro: 'Sem permissão para alterar status desta tarefa' });

  const campos = ['status = $2', 'updated_at = now()'];
  if (status === 'concluida') campos.push('data_conclusao = now()');
  else campos.push('data_conclusao = NULL');

  try {
    const { rows: [updated] } = await db.query(
      `UPDATE tarefas SET ${campos.join(', ')} WHERE id = $1 RETURNING *`,
      [req.params.id, status],
    );
    await db.query(
      `INSERT INTO tarefa_historico (tarefa_id, usuario_id, campo_alterado, valor_anterior, valor_novo)
       VALUES ($1, $2, 'status', $3, $4)`,
      [req.params.id, userId, current.status, status],
    ).catch(() => {});
    return res.json(updated);
  } catch (e) {
    console.error('[tarefas] PATCH status:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── DELETE /api/tarefas/:id → soft cancel (admin only) ──
router.delete('/:id', async (req, res) => {
  if (!ROLES_ADMIN.includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  try {
    const { rows: [updated] } = await db.query(
      `UPDATE tarefas SET status = 'cancelada', updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!updated) return res.status(404).json({ erro: 'Tarefa não encontrada' });
    return res.json({ ok: true, tarefa: updated });
  } catch (e) {
    console.error('[tarefas] DELETE:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ── POST /api/tarefas/:id/comentarios ──
router.post('/:id/comentarios', async (req, res) => {
  const { texto } = req.body ?? {};
  if (!texto?.trim()) return res.status(400).json({ erro: 'Texto é obrigatório' });

  try {
    const { rows: [com] } = await db.query(`
      INSERT INTO tarefa_comentarios (tarefa_id, usuario_id, texto)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.id, req.usuario.id, texto.trim()]);
    return res.status(201).json(com);
  } catch (e) {
    console.error('[tarefas] POST comentario:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
