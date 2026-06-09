'use strict';
const express    = require('express');
const router     = express.Router();
const autenticar = require('../middleware/autenticar');
const db         = require('../database/db');

function ok(res, data)        { res.json({ sucesso: true,  dados: data }); }
function erro(res, msg, s=400){ res.status(s).json({ sucesso: false, erro: msg }); }
function cap(fn){ return (req, res, next) => Promise.resolve(fn(req,res,next)).catch(next); }

// GET /api/dashboard — endpoint unificado (nunca retorna 500)
router.get('/', autenticar, cap(async (req, res) => {
  const safe = async (fn) => {
    try { return await fn(); } catch (e) { console.error('[Dashboard]', e.message); return null; }
  };

  // Nome do usuário logado
  const userRow = await safe(() =>
    db.query('SELECT nome FROM usuarios WHERE id = $1', [req.usuario.id])
  );
  const userNome = userRow?.rows[0]?.nome || req.usuario.email || '';

  // Clientes ativos + MRR
  const clientesRow = await safe(() =>
    db.query('SELECT COUNT(*)::int AS total, COALESCE(SUM(valor_contrato),0) AS mrr FROM clientes WHERE ativo = TRUE')
  );

  // Contagens de pregões + volume vencido
  const pregoesRow = await safe(() =>
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'a_disputar')::int AS abertos,
        COUNT(*) FILTER (WHERE status = 'vencido')::int    AS vencidos,
        COALESCE(SUM(valor_vencido) FILTER (WHERE status = 'vencido'), 0) AS volume_vencido
      FROM pregoes
    `)
  );

  // Prospects ativos (exclui perdido/convertido)
  const prospectsRow = await safe(() =>
    db.query("SELECT COUNT(*)::int AS total FROM prospects WHERE status NOT IN ('perdido','convertido')")
  );

  // Próximos pregões (próximos 7 dias, status a_disputar)
  const proximosRow = await safe(() =>
    db.query(`
      SELECT p.id, p.numero, p.orgao, p.objeto,
             p.data_abertura, p.data_hora_abertura, p.status,
             c.nome AS cliente_nome
      FROM pregoes p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.status = 'a_disputar'
        AND p.data_abertura >= CURRENT_DATE
        AND p.data_abertura <= CURRENT_DATE + INTERVAL '7 days'
      ORDER BY p.data_abertura ASC, p.data_hora_abertura ASC NULLS LAST
      LIMIT 10
    `)
  );

  // Funil de prospecção (contagem por status)
  const funilRow = await safe(() =>
    db.query('SELECT status, COUNT(*)::int AS total FROM prospects GROUP BY status ORDER BY total DESC')
  );
  const funil = {};
  (funilRow?.rows ?? []).forEach(r => { funil[r.status] = r.total; });

  // Contratos pendentes de assinatura
  const pendentesRow = await safe(() =>
    db.query(`
      SELECT p.id, p.numero, p.objeto, p.data_abertura, c.nome AS cliente_nome
      FROM pregoes p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.status = 'vencido'
        AND (p.contrato_assinado IS NULL OR p.contrato_assinado = FALSE)
      ORDER BY p.created_at DESC
      LIMIT 5
    `)
  );

  res.json({
    usuario:            { nome: userNome },
    metricas: {
      clientes_ativos:  clientesRow?.rows[0]?.total       ?? 0,
      mrr:              clientesRow?.rows[0]?.mrr          ?? 0,
      pregoes_abertos:  pregoesRow?.rows[0]?.abertos       ?? 0,
      pregoes_vencidos: pregoesRow?.rows[0]?.vencidos      ?? 0,
      prospects:        prospectsRow?.rows[0]?.total       ?? 0,
      volume_total:     pregoesRow?.rows[0]?.volume_vencido ?? 0,
    },
    proximos_pregoes:   proximosRow?.rows   ?? [],
    funil,
    contratos_pendentes: pendentesRow?.rows ?? [],
  });
}));

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
          (SELECT COALESCE(SUM(valor_recebido),0) FROM comissoes
           WHERE status = 'recebida'
           AND DATE_TRUNC('month', data_recebimento) = DATE_TRUNC('month', NOW())) AS comissao_mes,

          (SELECT COALESCE(SUM(valor_recebido),0) FROM comissoes
           WHERE status = 'recebida'
           AND DATE_TRUNC('year', data_recebimento) = DATE_TRUNC('year', NOW())) AS comissao_ano,

          (SELECT COALESCE(SUM(valor_esperado),0) FROM comissoes
           WHERE status IN ('pendente','enviada','atrasada')) AS comissao_a_receber,

          (SELECT COUNT(*) FROM contratos
           WHERE status NOT IN ('concluido','rescindido'))::int AS contratos_ativos,

          (SELECT COALESCE(SUM(valor_contrato),0) FROM contratos
           WHERE status NOT IN ('concluido','rescindido')) AS carteira_total,

          (SELECT COUNT(*) FROM pregoes
           WHERE status NOT IN ('cancelado','concluido','fracassado'))::int AS pregoes_ativos,

          (SELECT COUNT(*) FROM clientes WHERE ativo = true)::int AS clientes_ativos
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
