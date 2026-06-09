'use strict';
const express    = require('express');
const router     = express.Router();
const autenticar = require('../middleware/autenticar');
const db         = require('../database/db');

function ok(res, data)        { res.json({ sucesso: true,  dados: data }); }
function erro(res, msg, s=400){ res.status(s).json({ sucesso: false, erro: msg }); }
function cap(fn){ return (req, res, next) => Promise.resolve(fn(req,res,next)).catch(next); }

// GET /api/dashboard/consolidado
router.get('/consolidado', autenticar, cap(async (req, res) => {

  const [pregoes, contratos, kpisFinanceiros, proximosVencimentos] =
    await Promise.all([

      db.query(`
        SELECT
          p.id, p.numero, p.orgao, p.objeto, p.data_abertura,
          p.status, p.valor_estimado, c.nome AS cliente_nome
        FROM pregoes p
        LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE p.status NOT IN ('cancelado', 'concluido', 'fracassado')
        ORDER BY p.data_abertura ASC
        LIMIT 20
      `),

      db.query(`
        SELECT
          co.id, co.cliente_nome, co.numero_pregao, co.orgao,
          co.valor_contrato, co.percentual_comissao, co.comissao_total,
          co.status, co.data_vitoria, co.data_assinatura,
          COALESCE(SUM(cm.valor_recebido) FILTER (
            WHERE cm.status = 'recebida'), 0) AS comissao_recebida,
          COALESCE(SUM(cm.valor_esperado) FILTER (
            WHERE cm.status IN ('pendente','enviada','atrasada')), 0) AS comissao_pendente
        FROM contratos co
        LEFT JOIN comissoes cm ON cm.contrato_id = co.id
        GROUP BY co.id
        ORDER BY co.data_vitoria DESC
        LIMIT 20
      `),

      db.query(`
        SELECT
          COALESCE(SUM(cm.valor_recebido) FILTER (
            WHERE cm.status = 'recebida'
            AND DATE_TRUNC('month', cm.data_recebimento) = DATE_TRUNC('month', NOW())
          ), 0) AS comissao_mes,

          COALESCE(SUM(cm.valor_recebido) FILTER (
            WHERE cm.status = 'recebida'
            AND DATE_TRUNC('year', cm.data_recebimento) = DATE_TRUNC('year', NOW())
          ), 0) AS comissao_ano,

          COALESCE(SUM(cm.valor_esperado) FILTER (
            WHERE cm.status IN ('pendente','enviada','atrasada')
          ), 0) AS comissao_a_receber,

          COUNT(DISTINCT co.id) FILTER (
            WHERE co.status NOT IN ('concluido','rescindido')
          )::int AS contratos_ativos,

          COALESCE(SUM(co.valor_contrato) FILTER (
            WHERE co.status NOT IN ('concluido','rescindido')
          ), 0) AS carteira_total,

          COUNT(DISTINCT p.id) FILTER (
            WHERE p.status NOT IN ('cancelado','concluido','fracassado')
          )::int AS pregoes_ativos,

          COUNT(DISTINCT cl.id) FILTER (
            WHERE cl.ativo = true
          )::int AS clientes_ativos

        FROM contratos co
        FULL JOIN comissoes cm ON cm.contrato_id = co.id
        FULL JOIN pregoes p ON p.cliente_id = co.cliente_id
        FULL JOIN clientes cl ON cl.id = co.cliente_id
      `),

      db.query(`
        SELECT d.tipo, d.data_vencimento,
               (d.data_vencimento - CURRENT_DATE) AS dias_restantes,
               c.nome AS cliente_nome
        FROM documentos_cliente d
        JOIN clientes c ON c.id = d.cliente_id
        WHERE d.data_vencimento IS NOT NULL
          AND d.data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + 15
          AND d.status NOT IN ('rejeitado')
        ORDER BY d.data_vencimento ASC
        LIMIT 10
      `),

    ]);

  ok(res, {
    pregoes:              pregoes.rows,
    contratos:            contratos.rows,
    kpis:                 kpisFinanceiros.rows[0],
    proximos_vencimentos: proximosVencimentos.rows,
  });
}));

router.use((err, req, res, next) => {
  console.error('[dashboard]', err.message);
  erro(res, err.message || 'Erro interno', 500);
});

module.exports = router;
