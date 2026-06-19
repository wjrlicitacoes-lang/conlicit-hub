const express = require('express');
const router = express.Router();
const autenticar = require('../middleware/autenticar');
const db = require('../database/db');
const { listar, definirHorario, excluir } = require('../controllers/calendarioController');

// ── Rotas originais (pregões) — PRESERVAR ──────────────────────
router.get('/', listar);
router.patch('/:pid', definirHorario);
router.delete('/:id', autenticar, excluir);

// ── Rotas Hub (calendario_conlicit) ────────────────────────────

// GET /calendario/hub?mes=&ano=&tipo=
router.get('/hub', autenticar, async (req, res) => {
  try {
    const { mes, ano, tipo } = req.query;
    const { role } = req.usuario;
    const conds = [`$1 = ANY(visivel_para_roles)`];
    const vals  = [role];
    let i = 2;

    if (mes && ano) {
      conds.push(`EXTRACT(MONTH FROM data_evento) = $${i++} AND EXTRACT(YEAR FROM data_evento) = $${i++}`);
      vals.push(mes, ano);
    }
    if (tipo) { conds.push(`tipo = $${i++}`); vals.push(tipo); }

    const { rows } = await db.query(
      `SELECT cc.*, c.nome AS cliente_nome FROM calendario_conlicit cc
       LEFT JOIN clientes c ON c.id = cc.cliente_id
       WHERE ${conds.join(' AND ')}
       ORDER BY data_evento ASC`,
      vals,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Calendario Hub]', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// GET /calendario/hub/proximos — próximos 30 dias filtrados por role
router.get('/hub/proximos', autenticar, async (req, res) => {
  try {
    const { role } = req.usuario;
    const { rows } = await db.query(
      `SELECT cc.*, c.nome AS cliente_nome FROM calendario_conlicit cc
       LEFT JOIN clientes c ON c.id = cc.cliente_id
       WHERE $1 = ANY(cc.visivel_para_roles)
         AND cc.data_evento >= CURRENT_DATE
         AND cc.data_evento <= CURRENT_DATE + INTERVAL '30 days'
       ORDER BY cc.data_evento ASC`,
      [role],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Calendario Hub] Proximos:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /calendario/hub — criar evento
router.post('/hub', autenticar, async (req, res) => {
  const rolesPermitidos = ['admin','socio_fundador'];
  if (!rolesPermitidos.includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  const {
    tipo, titulo, descricao, data_evento, data_encerramento,
    plataforma, orgao, valor_estimado, visivel_para_roles,
    oportunidade_id, cliente_id,
  } = req.body ?? {};

  if (!titulo || !data_evento)
    return res.status(400).json({ erro: 'titulo e data_evento são obrigatórios' });

  try {
    const { rows } = await db.query(
      `INSERT INTO calendario_conlicit
         (tipo, titulo, descricao, data_evento, data_encerramento,
          plataforma, orgao, valor_estimado, visivel_para_roles,
          oportunidade_id, cliente_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        tipo || 'reuniao', titulo, descricao || null,
        data_evento, data_encerramento || null,
        plataforma || null, orgao || null, valor_estimado || null,
        visivel_para_roles || ['admin','socio_fundador'],
        oportunidade_id || null, cliente_id || null,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[Calendario Hub] POST:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// DELETE /calendario/hub/:id
router.delete('/hub/:id', autenticar, async (req, res) => {
  if (!['admin','socio_fundador'].includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  try {
    const { rowCount } = await db.query(
      'DELETE FROM calendario_conlicit WHERE id=$1', [req.params.id],
    );
    if (rowCount === 0) return res.status(404).json({ erro: 'Evento não encontrado' });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
