const db = require('../database/db');

async function listar(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM pregoes WHERE cliente_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (erro) {
    console.error('Erro ao listar pregões:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criar(req, res) {
  const { id } = req.params;
  const { numero, orgao, objeto, data_abertura, valor_estimado, status } = req.body ?? {};

  if (!numero) return res.status(400).json({ erro: 'numero é obrigatório' });

  try {
    const { rows } = await db.query(
      `INSERT INTO pregoes (cliente_id, numero, orgao, objeto, data_abertura, valor_estimado, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, numero, orgao || null, objeto || null,
       data_abertura || null, parseFloat(valor_estimado) || null,
       status || 'a_disputar'],
    );
    return res.status(201).json(rows[0]);
  } catch (erro) {
    console.error('Erro ao criar pregão:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizar(req, res) {
  const { id, pid } = req.params;
  const { status, valor_vencido, comissao_gerada, numero, orgao, objeto, data_abertura, valor_estimado } = req.body ?? {};

  const campos = [];
  const valores = [];
  let idx = 1;

  if (status          !== undefined) { campos.push(`status = $${idx++}`);          valores.push(status); }
  if (valor_vencido   !== undefined) { campos.push(`valor_vencido = $${idx++}`);   valores.push(parseFloat(valor_vencido) || null); }
  if (comissao_gerada !== undefined) { campos.push(`comissao_gerada = $${idx++}`); valores.push(parseFloat(comissao_gerada) || null); }
  if (numero          !== undefined) { campos.push(`numero = $${idx++}`);          valores.push(numero); }
  if (orgao           !== undefined) { campos.push(`orgao = $${idx++}`);           valores.push(orgao); }
  if (objeto          !== undefined) { campos.push(`objeto = $${idx++}`);          valores.push(objeto); }
  if (data_abertura   !== undefined) { campos.push(`data_abertura = $${idx++}`);   valores.push(data_abertura || null); }
  if (valor_estimado  !== undefined) { campos.push(`valor_estimado = $${idx++}`);  valores.push(parseFloat(valor_estimado) || null); }

  if (campos.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });

  valores.push(pid);
  valores.push(id);
  try {
    const { rows } = await db.query(
      `UPDATE pregoes SET ${campos.join(', ')} WHERE id = $${idx++} AND cliente_id = $${idx++} RETURNING *`,
      valores,
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Pregão não encontrado' });
    return res.json(rows[0]);
  } catch (erro) {
    console.error('Erro ao atualizar pregão:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listar, criar, atualizar };
