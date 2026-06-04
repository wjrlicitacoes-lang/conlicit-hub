// db/posVitoriaDB.js
const pool = require('./db');

async function listarContratos(filtros = {}) {
  const condicoes = [];
  const valores = [];
  let idx = 1;
  if (filtros.status) { condicoes.push(`c.status = $${idx++}`); valores.push(filtros.status); }
  if (filtros.cliente_nome) { condicoes.push(`c.cliente_nome ILIKE $${idx++}`); valores.push(`%${filtros.cliente_nome}%`); }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const sql = `
    SELECT c.*,
      COUNT(nf.id)::int AS total_nfs,
      COALESCE(SUM(nf.valor_nf), 0) AS total_faturado,
      COALESCE(SUM(CASE WHEN co.status = 'recebida' THEN co.valor_recebido ELSE 0 END), 0) AS total_comissao_recebida,
      COALESCE(SUM(CASE WHEN co.status IN ('pendente','enviada','atrasada') THEN co.valor_esperado ELSE 0 END), 0) AS total_comissao_pendente
    FROM contratos c
    LEFT JOIN notas_fiscais nf ON nf.contrato_id = c.id
    LEFT JOIN comissoes co ON co.contrato_id = c.id
    ${where}
    GROUP BY c.id
    ORDER BY c.created_at DESC`;
  const result = await pool.query(sql, valores);
  return result.rows;
}

async function buscarContrato(id) {
  const result = await pool.query(
    `SELECT c.*,
      COALESCE(SUM(nf.valor_nf), 0) AS total_faturado,
      COUNT(nf.id)::int AS total_nfs,
      COALESCE(SUM(CASE WHEN co.status = 'recebida' THEN co.valor_recebido ELSE 0 END), 0) AS comissao_recebida,
      COALESCE(SUM(CASE WHEN co.status IN ('pendente','enviada','atrasada') THEN co.valor_esperado ELSE 0 END), 0) AS comissao_pendente
     FROM contratos c
     LEFT JOIN notas_fiscais nf ON nf.contrato_id = c.id
     LEFT JOIN comissoes co ON co.contrato_id = c.id
     WHERE c.id = $1
     GROUP BY c.id`, [id]);
  return result.rows[0] || null;
}

async function criarContrato(dados) {
  const { cliente_id, cliente_nome, modalidade, numero_pregao, orgao, objeto,
    valor_contrato, percentual_comissao, data_vitoria, data_assinatura,
    data_vigencia_inicio, data_vigencia_fim, status, observacoes } = dados;
  const result = await pool.query(
    `INSERT INTO contratos
      (cliente_id, cliente_nome, modalidade, numero_pregao, orgao, objeto,
       valor_contrato, percentual_comissao, data_vitoria, data_assinatura,
       data_vigencia_inicio, data_vigencia_fim, status, observacoes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [cliente_id || 0, cliente_nome, modalidade, numero_pregao, orgao, objeto,
     valor_contrato, percentual_comissao, data_vitoria, data_assinatura || null,
     data_vigencia_inicio || null, data_vigencia_fim || null, status || 'assinando', observacoes || null]);
  return result.rows[0];
}

async function atualizarContrato(id, dados) {
  const campos = [];
  const valores = [];
  let idx = 1;
  const permitidos = ['cliente_nome','modalidade','numero_pregao','orgao','objeto',
    'valor_contrato','percentual_comissao','data_vitoria','data_assinatura',
    'data_vigencia_inicio','data_vigencia_fim','status','observacoes'];
  for (const campo of permitidos) {
    if (dados[campo] !== undefined) { campos.push(`${campo} = $${idx++}`); valores.push(dados[campo]); }
  }
  if (!campos.length) throw new Error('Nenhum campo válido para atualizar');
  valores.push(id);
  const result = await pool.query(
    `UPDATE contratos SET ${campos.join(', ')} WHERE id = $${idx} RETURNING *`, valores);
  return result.rows[0] || null;
}

async function listarNotasFiscais(contrato_id = null, status_cobranca = null) {
  const condicoes = [];
  const valores = [];
  let idx = 1;
  if (contrato_id) { condicoes.push(`nf.contrato_id = $${idx++}`); valores.push(contrato_id); }
  if (status_cobranca) { condicoes.push(`nf.status_cobranca = $${idx++}`); valores.push(status_cobranca); }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT nf.*, c.cliente_nome, c.orgao, c.numero_pregao,
            co.status AS status_comissao, co.data_recebimento, co.id AS comissao_id
     FROM notas_fiscais nf
     JOIN contratos c ON c.id = nf.contrato_id
     LEFT JOIN comissoes co ON co.nota_fiscal_id = nf.id
     ${where}
     ORDER BY nf.data_emissao DESC`, valores);
  return result.rows;
}

async function criarNotaFiscal(dados) {
  const { contrato_id, numero_nf, data_emissao, valor_nf,
    percentual_aplicado, prazo_pagamento, observacoes, arquivo_nf_url } = dados;
  const contrato = await buscarContrato(contrato_id);
  if (!contrato) throw new Error('Contrato não encontrado');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const nfResult = await client.query(
      `INSERT INTO notas_fiscais
        (contrato_id, numero_nf, data_emissao, valor_nf, percentual_aplicado,
         prazo_pagamento, observacoes, arquivo_nf_url, status_cobranca)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendente') RETURNING *`,
      [contrato_id, numero_nf, data_emissao, valor_nf, percentual_aplicado,
       prazo_pagamento || null, observacoes || null, arquivo_nf_url || null]);
    const nf = nfResult.rows[0];
    const valorComissao = (valor_nf * percentual_aplicado) / 100;
    await client.query(
      `INSERT INTO comissoes (nota_fiscal_id, contrato_id, valor_esperado, data_cobranca, status)
       VALUES ($1,$2,$3,$4,'pendente')`,
      [nf.id, contrato_id, valorComissao, prazo_pagamento || null]);
    if (contrato.status === 'assinando') {
      await client.query(`UPDATE contratos SET status = 'ativo' WHERE id = $1`, [contrato_id]);
    }
    await client.query('COMMIT');
    return nf;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function atualizarStatusNF(id, status_cobranca) {
  const result = await pool.query(
    `UPDATE notas_fiscais SET status_cobranca = $1 WHERE id = $2 RETURNING *`,
    [status_cobranca, id]);
  return result.rows[0] || null;
}

async function listarComissoes(filtros = {}) {
  const condicoes = [];
  const valores = [];
  let idx = 1;
  if (filtros.contrato_id) { condicoes.push(`co.contrato_id = $${idx++}`); valores.push(filtros.contrato_id); }
  if (filtros.status) { condicoes.push(`co.status = $${idx++}`); valores.push(filtros.status); }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT co.*, c.cliente_nome, c.numero_pregao, c.orgao,
            nf.numero_nf, nf.data_emissao, nf.valor_nf
     FROM comissoes co
     JOIN contratos c ON c.id = co.contrato_id
     JOIN notas_fiscais nf ON nf.id = co.nota_fiscal_id
     ${where}
     ORDER BY co.created_at DESC`, valores);
  return result.rows;
}

async function registrarRecebimento(id, dados) {
  const { valor_recebido, data_recebimento, status, forma_pagamento, comprovante_ref, observacoes } = dados;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE comissoes SET
        valor_recebido = $1, data_recebimento = $2, status = $3,
        forma_pagamento = $4, comprovante_ref = $5, observacoes = $6
       WHERE id = $7 RETURNING *`,
      [valor_recebido, data_recebimento, status || 'recebida',
       forma_pagamento || null, comprovante_ref || null, observacoes || null, id]);
    const comissao = result.rows[0];
    if (!comissao) throw new Error('Comissão não encontrada');
    const novoStatusNF = status === 'recebida' ? 'recebido'
      : status === 'atrasada' ? 'atrasado'
      : status === 'enviada' ? 'cobranca_enviada' : 'negociando';
    await client.query(
      `UPDATE notas_fiscais SET status_cobranca = $1 WHERE id = $2`,
      [novoStatusNF, comissao.nota_fiscal_id]);
    await client.query('COMMIT');
    return comissao;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function buscarKPIs() {
  const result = await pool.query(`
    SELECT
      COUNT(DISTINCT c.id)::int AS total_contratos_ativos,
      COALESCE(SUM(c.valor_contrato) FILTER (WHERE c.status NOT IN ('concluido','rescindido')), 0) AS valor_total_contratos,
      COUNT(nf.id) FILTER (WHERE nf.status_cobranca = 'pendente')::int AS nfs_aguardando_cobranca,
      COALESCE(SUM(co.valor_esperado) FILTER (WHERE co.status IN ('pendente','enviada','atrasada')), 0) AS comissao_a_receber,
      COALESCE(SUM(co.valor_recebido) FILTER (
        WHERE co.status = 'recebida'
        AND EXTRACT(MONTH FROM co.data_recebimento) = EXTRACT(MONTH FROM NOW())
        AND EXTRACT(YEAR FROM co.data_recebimento) = EXTRACT(YEAR FROM NOW())
      ), 0) AS comissao_recebida_mes,
      COUNT(co.id) FILTER (WHERE co.status = 'atrasada')::int AS cobrancas_atrasadas
    FROM contratos c
    LEFT JOIN notas_fiscais nf ON nf.contrato_id = c.id
    LEFT JOIN comissoes co ON co.contrato_id = c.id`);
  return result.rows[0];
}

module.exports = {
  listarContratos, buscarContrato, criarContrato, atualizarContrato,
  listarNotasFiscais, criarNotaFiscal, atualizarStatusNF,
  listarComissoes, registrarRecebimento, buscarKPIs,
};
