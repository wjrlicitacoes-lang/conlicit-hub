const db = require('../database/db');

async function listar(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM mensalidades WHERE cliente_id = $1 ORDER BY mes_ano DESC, created_at DESC`,
      [id],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (erro) {
    console.error('Erro ao listar mensalidades:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criar(req, res) {
  const { id } = req.params;
  const { mes_ano, valor, data_vencimento, status } = req.body ?? {};

  if (!mes_ano) return res.status(400).json({ erro: 'mes_ano é obrigatório (formato YYYY-MM)' });
  if (valor === undefined) return res.status(400).json({ erro: 'valor é obrigatório' });

  try {
    const { rows } = await db.query(
      `INSERT INTO mensalidades (cliente_id, mes_ano, valor, data_vencimento, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, mes_ano, parseFloat(valor) || 0, data_vencimento || null, status || 'pendente'],
    );
    return res.status(201).json(rows[0]);
  } catch (erro) {
    console.error('Erro ao criar mensalidade:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizar(req, res) {
  const { id, mid } = req.params;
  const { status, data_recebimento, valor, data_vencimento } = req.body ?? {};

  const campos = [];
  const valores = [];
  let idx = 1;

  if (status           !== undefined) { campos.push(`status = $${idx++}`);           valores.push(status); }
  if (data_recebimento !== undefined) { campos.push(`data_recebimento = $${idx++}`); valores.push(data_recebimento || null); }
  if (valor            !== undefined) { campos.push(`valor = $${idx++}`);            valores.push(parseFloat(valor) || 0); }
  if (data_vencimento  !== undefined) { campos.push(`data_vencimento = $${idx++}`);  valores.push(data_vencimento || null); }

  if (campos.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });

  valores.push(mid);
  valores.push(id);
  try {
    const { rows } = await db.query(
      `UPDATE mensalidades SET ${campos.join(', ')} WHERE id = $${idx++} AND cliente_id = $${idx++} RETURNING *`,
      valores,
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Mensalidade não encontrada' });
    return res.json(rows[0]);
  } catch (erro) {
    console.error('Erro ao atualizar mensalidade:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listar, criar, atualizar };
