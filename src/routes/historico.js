const express    = require('express');
const db         = require('../database/db');
const autenticar = require('../middleware/autenticar');

const router = express.Router();
router.use(autenticar);

// GET /api/historico?cliente_id=&resultado=&de=&ate=
router.get('/', async (req, res) => {
  const { cliente_id, resultado, de, ate } = req.query;
  const wheres  = [];
  const valores = [];
  let idx = 1;

  if (cliente_id) { wheres.push(`cliente_id = $${idx++}`);  valores.push(cliente_id); }
  if (resultado)  { wheres.push(`resultado = $${idx++}`);   valores.push(resultado); }
  if (de)         { wheres.push(`data_pregao >= $${idx++}`); valores.push(de); }
  if (ate)        { wheres.push(`data_pregao <= $${idx++}`); valores.push(ate); }

  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  try {
    const { rows } = await db.query(
      `SELECT hc.*, c.nome AS cliente_nome
       FROM historico_certames hc
       LEFT JOIN clientes c ON c.id = hc.cliente_id
       ${where}
       ORDER BY hc.data_pregao DESC`,
      valores,
    );
    return res.json(rows);
  } catch (e) {
    console.error('[historico] listar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// GET /api/historico/kpis
router.get('/kpis', async (req, res) => {
  const { cliente_id } = req.query;
  const where  = cliente_id ? 'WHERE cliente_id = $1' : '';
  const params = cliente_id ? [cliente_id] : [];

  try {
    const { rows } = await db.query(
      `SELECT resultado, nosso_lance, taxa_sucesso FROM historico_certames ${where}`,
      params,
    );
    const total       = rows.length;
    const vitorias    = rows.filter(r => r.resultado === 'vitoria').length;
    const em_andamento = rows.filter(r => r.resultado === 'em_andamento').length;
    const taxa        = total > 0 ? ((vitorias / total) * 100).toFixed(1) : '0.0';
    const receita     = rows
      .filter(r => r.resultado === 'vitoria' && r.taxa_sucesso)
      .reduce((acc, r) => acc + (parseFloat(r.nosso_lance || 0) * 0.05), 0);

    return res.json({ total, vitorias, em_andamento, taxa, receita });
  } catch (e) {
    console.error('[historico] kpis:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// POST /api/historico
router.post('/', async (req, res) => {
  const {
    cliente_id, data_pregao, numero_pregao, objeto, orgao, uf, plataforma,
    resultado, motivo, valor_estimado, nosso_lance, lance_vencedor,
    concorrente_vencedor, num_concorrentes, taxa_sucesso, responsavel,
  } = req.body ?? {};

  if (!data_pregao || !numero_pregao) {
    return res.status(400).json({ erro: 'data_pregao e numero_pregao são obrigatórios' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO historico_certames
         (cliente_id, data_pregao, numero_pregao, objeto, orgao, uf, plataforma,
          resultado, motivo, valor_estimado, nosso_lance, lance_vencedor,
          concorrente_vencedor, num_concorrentes, taxa_sucesso, responsavel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        cliente_id || null, data_pregao, numero_pregao, objeto || null, orgao || null,
        uf || null, plataforma || null, resultado || 'em_andamento', motivo || null,
        valor_estimado || null, nosso_lance || null, lance_vencedor || null,
        concorrente_vencedor || null, num_concorrentes || null,
        taxa_sucesso === true || taxa_sucesso === 'true', responsavel || null,
      ],
    );
    return res.status(201).json({ sucesso: true, certame: rows[0] });
  } catch (e) {
    console.error('[historico] criar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// PUT /api/historico/:id
router.put('/:id', async (req, res) => {
  const campos  = [];
  const valores = [];
  let idx = 1;

  const permitidos = [
    'data_pregao','numero_pregao','objeto','orgao','uf','plataforma','resultado',
    'motivo','valor_estimado','nosso_lance','lance_vencedor','concorrente_vencedor',
    'num_concorrentes','taxa_sucesso','responsavel',
  ];

  for (const campo of permitidos) {
    if (req.body[campo] !== undefined) {
      campos.push(`${campo} = $${idx++}`);
      valores.push(req.body[campo]);
    }
  }

  if (!campos.length) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
  valores.push(req.params.id);

  try {
    const { rows } = await db.query(
      `UPDATE historico_certames SET ${campos.join(', ')} WHERE id = $${idx} RETURNING *`,
      valores,
    );
    if (!rows.length) return res.status(404).json({ erro: 'Registro não encontrado' });
    return res.json({ sucesso: true, certame: rows[0] });
  } catch (e) {
    console.error('[historico] atualizar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
