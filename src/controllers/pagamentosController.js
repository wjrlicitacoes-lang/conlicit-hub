'use strict';
const db = require('../database/db');

// ── Auxiliares ────────────────────────────────────────────────────────────────

function getNesimoDiaUtil(ano, mes, n) {
  let count = 0;
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  for (let d = 1; d <= diasNoMes; d++) {
    const dt = new Date(ano, mes, d);
    const dow = dt.getDay();
    if (dow !== 0 && dow !== 6) {
      count++;
      if (count === n) return dt;
    }
  }
  return null;
}

function toISO(date) {
  return date.toISOString().split('T')[0];
}

async function gerarLancamentos(clienteId, configId, mesesAFrente = 3) {
  const { rows: [config] } = await db.query(
    'SELECT * FROM cliente_pagamentos_config WHERE id = $1',
    [configId],
  );
  if (!config || !config.ativo) return 0;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const lancamentos = [];

  if (config.tipo_recorrencia === 'mensal_dia_fixo') {
    for (let m = 0; m <= mesesAFrente; m++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + m, config.dia_mes);
      if (d >= hoje) lancamentos.push(toISO(d));
    }
  } else if (config.tipo_recorrencia === 'mensal_dia_util') {
    for (let m = 0; m <= mesesAFrente; m++) {
      const d = getNesimoDiaUtil(hoje.getFullYear(), hoje.getMonth() + m, config.numero_dia_util);
      if (d && d >= hoje) lancamentos.push(toISO(d));
    }
  } else if (config.tipo_recorrencia === 'semanal') {
    let cursor = new Date(hoje);
    while (cursor.getDay() !== config.dia_semana) cursor.setDate(cursor.getDate() + 1);
    for (let w = 0; w < 12; w++) {
      lancamentos.push(toISO(cursor));
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 7);
    }
  } else if (config.tipo_recorrencia === 'quinzenal') {
    let cursor = new Date(hoje);
    for (let i = 0; i < 6; i++) {
      lancamentos.push(toISO(cursor));
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 15);
    }
  } else if (config.tipo_recorrencia === 'personalizado') {
    const datas = Array.isArray(config.datas_customizadas) ? config.datas_customizadas : [];
    for (const ds of datas) {
      const d = new Date(ds + 'T12:00:00');
      if (d >= hoje) lancamentos.push(toISO(d));
    }
  }

  let inseridos = 0;
  for (const dataVenc of lancamentos) {
    const { rows: [existe] } = await db.query(
      `SELECT id FROM cliente_pagamentos_lancamentos
       WHERE cliente_id = $1 AND config_id = $2 AND data_vencimento = $3`,
      [clienteId, configId, dataVenc],
    );
    if (!existe) {
      await db.query(
        `INSERT INTO cliente_pagamentos_lancamentos (cliente_id, config_id, valor, data_vencimento, status)
         VALUES ($1, $2, $3, $4, 'pendente')`,
        [clienteId, configId, config.valor, dataVenc],
      );
      inseridos++;
    }
  }
  return inseridos;
}

// ── Endpoints de configuração ─────────────────────────────────────────────────

async function listarConfigs(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM cliente_pagamentos_config WHERE cliente_id = $1 AND ativo = TRUE ORDER BY created_at ASC`,
      [id],
    );
    return res.json({ dados: rows, total: rows.length });
  } catch (e) {
    console.error('[Pagamentos] listarConfigs:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criarConfig(req, res) {
  const { id } = req.params;
  const { descricao, tipo_recorrencia, valor, dia_mes, numero_dia_util, dia_semana, datas_customizadas } = req.body ?? {};

  const tiposValidos = ['mensal_dia_fixo', 'mensal_dia_util', 'semanal', 'quinzenal', 'personalizado'];
  if (!tipo_recorrencia || !tiposValidos.includes(tipo_recorrencia))
    return res.status(400).json({ erro: `tipo_recorrencia inválido. Opções: ${tiposValidos.join(', ')}` });
  if (!valor || isNaN(Number(valor)))
    return res.status(400).json({ erro: 'valor é obrigatório e deve ser numérico' });

  try {
    const { rows: [config] } = await db.query(
      `INSERT INTO cliente_pagamentos_config
         (cliente_id, descricao, tipo_recorrencia, valor, dia_mes, numero_dia_util, dia_semana, datas_customizadas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id,
        descricao?.trim() || null,
        tipo_recorrencia,
        Number(valor),
        dia_mes ? parseInt(dia_mes) : null,
        numero_dia_util ? parseInt(numero_dia_util) : null,
        dia_semana !== undefined && dia_semana !== null ? parseInt(dia_semana) : null,
        datas_customizadas ? JSON.stringify(datas_customizadas) : null,
      ],
    );

    const inseridos = await gerarLancamentos(parseInt(id), config.id, 3);
    console.log(`[Pagamentos] Config ${config.id} criada → ${inseridos} lançamentos gerados`);

    return res.status(201).json({ config, lancamentos_gerados: inseridos });
  } catch (e) {
    console.error('[Pagamentos] criarConfig:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function desativarConfig(req, res) {
  const { id, config_id } = req.params;
  try {
    const { rowCount } = await db.query(
      `UPDATE cliente_pagamentos_config SET ativo = FALSE WHERE id = $1 AND cliente_id = $2`,
      [config_id, id],
    );
    if (!rowCount) return res.status(404).json({ erro: 'Configuração não encontrada' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Pagamentos] desativarConfig:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Endpoints de lançamentos ──────────────────────────────────────────────────

async function listarLancamentos(req, res) {
  const { id } = req.params;
  const { status, mes, limit = '50' } = req.query;
  const conds = ['l.cliente_id = $1'];
  const vals  = [id];

  if (status) { vals.push(status); conds.push(`l.status = $${vals.length}`); }
  if (mes) {
    vals.push(`${mes}-01`);
    vals.push(`${mes}-31`);
    conds.push(`l.data_vencimento >= $${vals.length - 1} AND l.data_vencimento <= $${vals.length}`);
  }

  try {
    const { rows } = await db.query(
      `SELECT l.*, c.descricao AS config_descricao, c.tipo_recorrencia
       FROM cliente_pagamentos_lancamentos l
       LEFT JOIN cliente_pagamentos_config c ON c.id = l.config_id
       WHERE ${conds.join(' AND ')}
       ORDER BY l.data_vencimento ASC
       LIMIT $${vals.length + 1}`,
      [...vals, parseInt(limit)],
    );
    return res.json({ dados: rows, total: rows.length });
  } catch (e) {
    console.error('[Pagamentos] listarLancamentos:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizarLancamento(req, res) {
  const { id, lancamento_id } = req.params;
  const { status, data_pagamento, observacao } = req.body ?? {};
  if (!status) return res.status(400).json({ erro: 'status é obrigatório' });

  const statusValidos = ['pendente', 'pago', 'atrasado', 'cancelado'];
  if (!statusValidos.includes(status))
    return res.status(400).json({ erro: `status inválido. Opções: ${statusValidos.join(', ')}` });

  try {
    const { rows: [l] } = await db.query(
      `UPDATE cliente_pagamentos_lancamentos SET
         status         = $1,
         data_pagamento = $2,
         observacao     = COALESCE($3, observacao)
       WHERE id = $4 AND cliente_id = $5
       RETURNING *`,
      [status, data_pagamento || null, observacao || null, lancamento_id, id],
    );
    if (!l) return res.status(404).json({ erro: 'Lançamento não encontrado' });
    return res.json(l);
  } catch (e) {
    console.error('[Pagamentos] atualizarLancamento:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Cron: gerar lançamentos do próximo mês ────────────────────────────────────

async function cronGerarLancamentos(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ erro: 'Unauthorized' });
  }
  try {
    const { rows: configs } = await db.query(
      `SELECT DISTINCT cliente_id, id FROM cliente_pagamentos_config WHERE ativo = TRUE`,
    );
    let total = 0;
    for (const c of configs) {
      total += await gerarLancamentos(c.cliente_id, c.id, 2);
    }
    console.log(`[Cron] Lançamentos gerados: ${total}`);
    return res.json({ ok: true, lancamentos_gerados: total, configs_processadas: configs.length });
  } catch (e) {
    console.error('[Cron] cronGerarLancamentos:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

// ── MRR calculado a partir das configs ────────────────────────────────────────

async function calcularMRR() {
  // Clientes com configs novas
  const { rows: configs } = await db.query(
    `SELECT cpc.valor, cpc.tipo_recorrencia, cpc.cliente_id
     FROM cliente_pagamentos_config cpc
     JOIN clientes cl ON cl.id = cpc.cliente_id
     WHERE cpc.ativo = TRUE AND cl.ativo = TRUE`,
  );

  const clientesComConfig = new Set();
  let total = 0;
  for (const c of configs) {
    clientesComConfig.add(c.cliente_id);
    if (c.tipo_recorrencia === 'semanal') {
      total += parseFloat(c.valor) * 4.33;
    } else if (c.tipo_recorrencia === 'quinzenal') {
      total += parseFloat(c.valor) * 2;
    } else {
      total += parseFloat(c.valor);
    }
  }

  // Fallback: clientes sem config nova mas com valor_contrato antigo
  if (clientesComConfig.size > 0) {
    const ids = [...clientesComConfig].join(',');
    const { rows: antigos } = await db.query(
      `SELECT COALESCE(SUM(valor_contrato),0) AS soma
       FROM clientes WHERE ativo = TRUE AND id NOT IN (${ids})`,
    );
    total += parseFloat(antigos[0]?.soma || 0);
  } else {
    const { rows: todos } = await db.query(
      `SELECT COALESCE(SUM(valor_contrato),0) AS soma FROM clientes WHERE ativo = TRUE`,
    );
    total += parseFloat(todos[0]?.soma || 0);
  }

  return total;
}

module.exports = {
  listarConfigs, criarConfig, desativarConfig,
  listarLancamentos, atualizarLancamento,
  cronGerarLancamentos, calcularMRR, gerarLancamentos,
};
