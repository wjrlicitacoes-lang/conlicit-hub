'use strict';
const express    = require('express');
const router     = express.Router();
const autenticar = require('../middleware/autenticar');
const db         = require('../database/db');

function ok(res, data, s=200) { res.status(s).json({ sucesso: true,  dados: data }); }
function erro(res, msg, s=400){ res.status(s).json({ sucesso: false, erro: msg }); }
function cap(fn){ return (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next); }

const CATEGORIAS = {
  pro_labore:'Pró-labore Sócios', salario:'Salários',
  infraestrutura:'Infraestrutura', apis:'APIs e Integrações',
  ferramentas:'Ferramentas SaaS', marketing:'Marketing',
  outros:'Outros',
};

// GET /api/financeiro/resumo?mes=2025-06
router.get('/resumo', autenticar, cap(async (req, res) => {
  const mes  = req.query.mes || new Date().toISOString().slice(0,7);
  const ini  = mes + '-01';
  const fim  = new Date(new Date(ini).setMonth(new Date(ini).getMonth()+1,0))
               .toISOString().slice(0,10);

  const [lancamentos, comissoesRecebidas] = await Promise.all([
    db.query(
      `SELECT * FROM financeiro_lancamentos
       WHERE data BETWEEN $1 AND $2
       ORDER BY data DESC`, [ini, fim]
    ),
    db.query(
      `SELECT COALESCE(SUM(valor_recebido),0) AS total
       FROM comissoes
       WHERE status = 'recebida'
         AND data_recebimento BETWEEN $1 AND $2`, [ini, fim]
    ),
  ]);

  const receitas_comissoes = parseFloat(comissoesRecebidas.rows[0].total);
  const receitas_manuais   = lancamentos.rows
    .filter(l => l.tipo === 'receita')
    .reduce((s,l) => s + parseFloat(l.valor), 0);
  const despesas_total     = lancamentos.rows
    .filter(l => l.tipo === 'despesa')
    .reduce((s,l) => s + parseFloat(l.valor), 0);

  const total_receitas = receitas_comissoes + receitas_manuais;
  const resultado      = total_receitas - despesas_total;

  const por_categoria = {};
  lancamentos.rows.filter(l => l.tipo === 'despesa').forEach(l => {
    if (!por_categoria[l.categoria]) por_categoria[l.categoria] = 0;
    por_categoria[l.categoria] += parseFloat(l.valor);
  });

  ok(res, {
    mes, ini, fim,
    receitas: {
      comissoes: receitas_comissoes,
      manuais:   receitas_manuais,
      total:     total_receitas,
    },
    despesas: {
      total:        despesas_total,
      por_categoria: Object.entries(por_categoria).map(([cat, val]) => ({
        categoria: cat,
        nome:      CATEGORIAS[cat] || cat,
        valor:     val,
      })),
    },
    resultado,
    margem: total_receitas > 0
      ? Math.round((resultado / total_receitas) * 100) : 0,
    lancamentos: lancamentos.rows,
  });
}));

// GET /api/financeiro/lancamentos
router.get('/lancamentos', autenticar, cap(async (req, res) => {
  const { mes, tipo } = req.query;
  const conds = []; const vals = [];
  let i = 1;
  if (mes) {
    conds.push(`DATE_TRUNC('month',data) = DATE_TRUNC('month',$${i++}::date)`);
    vals.push(mes + '-01');
  }
  if (tipo) { conds.push(`tipo = $${i++}`); vals.push(tipo); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const r = await db.query(
    `SELECT * FROM financeiro_lancamentos ${where} ORDER BY data DESC`, vals);
  ok(res, r.rows);
}));

// POST /api/financeiro/lancamentos
router.post('/lancamentos', autenticar, cap(async (req, res) => {
  const { tipo, categoria, descricao, valor, data, recorrente, referencia } = req.body;
  if (!tipo || !categoria || !descricao || !valor || !data)
    return erro(res, 'tipo, categoria, descricao, valor e data são obrigatórios');
  if (!['receita','despesa'].includes(tipo))
    return erro(res, 'tipo deve ser receita ou despesa');
  const r = await db.query(
    `INSERT INTO financeiro_lancamentos
      (tipo,categoria,descricao,valor,data,recorrente,referencia)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tipo, categoria, descricao, valor, data,
     recorrente || false, referencia || null]
  );
  ok(res, r.rows[0], 201);
}));

// DELETE /api/financeiro/lancamentos/:id
router.delete('/lancamentos/:id', autenticar, cap(async (req, res) => {
  const r = await db.query(
    `DELETE FROM financeiro_lancamentos WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (!r.rows.length) return erro(res, 'Lançamento não encontrado', 404);
  ok(res, { deletado: true });
}));

router.use((err, req, res, next) => {
  console.error('[financeiro]', err.message);
  erro(res, err.message || 'Erro interno', 500);
});

module.exports = router;
