const express    = require('express');
const db         = require('../database/db');
const autenticar = require('../middleware/autenticar');

const router = express.Router();
router.use(autenticar);

// POST /api/pregao/estrategia
router.post('/estrategia', async (req, res) => {
  const { cliente_id, pregao_id, numero_pregao, orgao, valor_estimado, valor_minimo, margem_seguranca = 5.0 } = req.body ?? {};
  if (!pregao_id) return res.status(400).json({ erro: 'pregao_id é obrigatório' });

  try {
    const { rows } = await db.query(
      `INSERT INTO pregao_estrategia (cliente_id, pregao_id, numero_pregao, orgao, valor_estimado, valor_minimo, margem_seguranca)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (pregao_id) DO UPDATE SET
         numero_pregao    = EXCLUDED.numero_pregao,
         orgao            = EXCLUDED.orgao,
         valor_estimado   = EXCLUDED.valor_estimado,
         valor_minimo     = EXCLUDED.valor_minimo,
         margem_seguranca = EXCLUDED.margem_seguranca,
         updated_at       = now()
       RETURNING *`,
      [cliente_id || null, pregao_id, numero_pregao || null, orgao || null, valor_estimado || null, valor_minimo || null, margem_seguranca],
    );
    return res.json({ sucesso: true, estrategia: rows[0] });
  } catch (e) {
    console.error('[pregaoEstrategia] salvar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// GET /api/pregao/estrategia/:pregao_id
router.get('/estrategia/:pregao_id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM pregao_estrategia WHERE pregao_id = $1`,
      [req.params.pregao_id],
    );
    return res.json(rows[0] || null);
  } catch (e) {
    console.error('[pregaoEstrategia] buscar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// POST /api/pregao/calcular-lance
router.post('/calcular-lance', async (req, res) => {
  const { pregao_id, lance_concorrente } = req.body ?? {};
  if (!pregao_id || lance_concorrente == null) {
    return res.status(400).json({ erro: 'pregao_id e lance_concorrente são obrigatórios' });
  }

  try {
    const { rows } = await db.query(
      `SELECT valor_minimo, margem_seguranca FROM pregao_estrategia WHERE pregao_id = $1`,
      [pregao_id],
    );

    const estrategia = rows[0];
    if (!estrategia) return res.status(404).json({ erro: 'Estratégia não encontrada para este pregão' });

    const { valor_minimo, margem_seguranca } = estrategia;
    const concorrente     = parseFloat(lance_concorrente);
    const lance_sugerido  = concorrente - 1.00;
    const pode_dar_lance  = lance_sugerido >= parseFloat(valor_minimo);
    const margem_atual    = ((lance_sugerido - parseFloat(valor_minimo)) / lance_sugerido) * 100;

    const alerta = !pode_dar_lance
      ? `Lance abaixo do mínimo (R$ ${parseFloat(valor_minimo).toFixed(2)}). Não recomendar.`
      : margem_atual < parseFloat(margem_seguranca)
      ? `Margem apertada: ${margem_atual.toFixed(1)}%. Confirmar com Werbert.`
      : null;

    return res.json({ pode_dar_lance, lance_sugerido, margem_atual, valor_minimo: parseFloat(valor_minimo), alerta });
  } catch (e) {
    console.error('[pregaoEstrategia] calcular-lance:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
