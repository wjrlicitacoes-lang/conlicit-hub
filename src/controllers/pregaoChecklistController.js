const db = require('../database/db');

// Semeia pregao_checklist a partir do JSON já gerado pelo Edson (analises_edson.checklist:
// {antes:[str], durante:[str], apos:[str]}), transformando os itens estáticos em linhas
// marcáveis. Só roda se a tabela ainda não tiver linhas para o pregão.
async function semearSeNecessario(pregaoId) {
  const { rows: [existente] } = await db.query(
    `SELECT id FROM pregao_checklist WHERE pregao_id = $1 LIMIT 1`,
    [pregaoId],
  );
  if (existente) return;

  const { rows: [analise] } = await db.query(
    `SELECT checklist FROM analises_edson WHERE pregao_id = $1 AND status = 'concluido'`,
    [pregaoId],
  );
  const checklist = analise?.checklist;
  if (!checklist) return;

  for (const etapa of ['antes', 'durante', 'apos']) {
    for (const item of (checklist[etapa] || [])) {
      await db.query(
        `INSERT INTO pregao_checklist (pregao_id, etapa, item) VALUES ($1,$2,$3)`,
        [pregaoId, etapa, item],
      );
    }
  }
}

async function listar(req, res) {
  const { pid } = req.params;
  try {
    await semearSeNecessario(pid);
    const { rows } = await db.query(
      `SELECT * FROM pregao_checklist WHERE pregao_id = $1
       ORDER BY CASE etapa WHEN 'antes' THEN 1 WHEN 'durante' THEN 2 ELSE 3 END, id`,
      [pid],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[PregaoChecklist] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function marcar(req, res) {
  const { pid, itemId } = req.params;
  const { concluido } = req.body ?? {};
  try {
    const { rows: [item] } = await db.query(
      `UPDATE pregao_checklist SET
         concluido = $1,
         concluido_por = CASE WHEN $1 THEN $2 ELSE NULL END,
         concluido_em  = CASE WHEN $1 THEN NOW() ELSE NULL END
       WHERE id = $3 AND pregao_id = $4
       RETURNING *`,
      [Boolean(concluido), req.usuario?.id || null, itemId, pid],
    );
    if (!item) return res.status(404).json({ erro: 'Item de checklist não encontrado' });
    return res.json(item);
  } catch (e) {
    console.error('[PregaoChecklist] marcar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listar, marcar };
