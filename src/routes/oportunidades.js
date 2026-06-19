const router = require('express').Router();
const auth   = require('../middleware/autenticar');
const ctrl   = require('../controllers/oportunidadesController');
const db     = require('../database/db');
const { processarOportunidadesParaCliente } = require('../services/oportunidadesHub');
const { processarConfirmacaoCliente }       = require('../services/posConfirmacao');

// ── Rotas sem parâmetro de ID — devem vir antes de /:id ───────

router.post('/webhook/zapi', ctrl.webhookZapi);
router.get ('/grupos',       auth, ctrl.listarGrupos);

// POST /oportunidades/disparar-teste?cliente_id=<uuid>  (hub)
router.post('/disparar-teste', auth, async (req, res) => {
  if (!['admin','socio_fundador'].includes(req.usuario.role))
    return res.status(403).json({ erro: 'Acesso restrito ao admin ou sócio fundador' });

  const { cliente_id } = req.query;
  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id obrigatório' });

  try {
    const { rows } = await db.query('SELECT * FROM clientes WHERE id=$1', [cliente_id]);
    if (!rows.length) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const stats = await processarOportunidadesParaCliente(rows[0]);
    return res.json(stats);
  } catch (e) {
    console.error('[Oportunidades Hub] Disparar teste:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// GET /oportunidades — lista da nova tabela (hub)
router.get('/', auth, async (req, res) => {
  try {
    const { cliente_id, status, data_inicio, data_fim } = req.query;
    const conds = [];
    const vals  = [];
    let i = 1;

    if (cliente_id)  { conds.push(`o.cliente_id = $${i++}`);         vals.push(cliente_id); }
    if (status)      { conds.push(`o.status = $${i++}`);             vals.push(status); }
    if (data_inicio) { conds.push(`o.data_encerramento >= $${i++}`); vals.push(data_inicio); }
    if (data_fim)    { conds.push(`o.data_encerramento <= $${i++}`); vals.push(data_fim); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT o.*, c.nome AS cliente_nome
       FROM oportunidades o
       JOIN clientes c ON c.id = o.cliente_id
       ${where}
       ORDER BY o.data_envio DESC`,
      vals,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Oportunidades Hub] GET:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// POST /oportunidades — criar (oportunidades_fila, legado)
router.post('/', auth, ctrl.criar);

// ── Rotas com :id ─────────────────────────────────────────────

router.get   ('/:id',            auth, ctrl.buscarPorId);
router.post  ('/:id/resumo',     auth, ctrl.gerarResumo);
router.post  ('/:id/disparar',   auth, ctrl.disparar);
router.patch ('/:id/resposta',   auth, ctrl.registrarResposta);
router.delete('/:id',            auth, ctrl.excluir);
router.post  ('/:id/encaminhar', auth, ctrl.encaminhar);

// PATCH /oportunidades/:id/status — novo workflow (hub)
router.patch('/:id/status', auth, async (req, res) => {
  const rolesPermitidos = ['admin','socio_fundador','diretor_comercial'];
  if (!rolesPermitidos.includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  const { status } = req.body ?? {};
  const statusValidos = ['aguardando_resposta','interesse','sem_interesse','expirado'];
  if (!statusValidos.includes(status))
    return res.status(400).json({ erro: 'Status inválido' });

  try {
    const { rows } = await db.query(
      `UPDATE oportunidades SET status=$2, data_resposta=now() WHERE id=$1 RETURNING *`,
      [req.params.id, status],
    );
    if (!rows.length) return res.status(404).json({ erro: 'Oportunidade não encontrada' });

    if (status === 'interesse') {
      processarConfirmacaoCliente(req.params.id).catch(e =>
        console.error('[Oportunidades Hub] Pós-confirmação:', e.message),
      );
    }
    return res.json(rows[0]);
  } catch (e) {
    console.error('[Oportunidades Hub] PATCH status:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

module.exports = router;
