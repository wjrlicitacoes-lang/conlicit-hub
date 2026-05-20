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
  const { numero, orgao, objeto, data_abertura, valor_estimado, status,
          data_hora_abertura, operador_id, numero_controle_pncp, link_pncp } = req.body ?? {};

  if (!numero) return res.status(400).json({ erro: 'numero é obrigatório' });

  try {
    const { rows } = await db.query(
      `INSERT INTO pregoes
         (cliente_id, numero, orgao, objeto, data_abertura, valor_estimado, status,
          data_hora_abertura, operador_id, numero_controle_pncp, link_pncp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, numero, orgao || null, objeto || null,
       data_abertura || null, parseFloat(valor_estimado) || null,
       status || 'a_disputar',
       data_hora_abertura || null,
       operador_id ? parseInt(operador_id) : null,
       numero_controle_pncp?.trim() || null,
       link_pncp?.trim() || null],
    );
    return res.status(201).json(rows[0]);
  } catch (erro) {
    console.error('Erro ao criar pregão:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizar(req, res) {
  const { id, pid } = req.params;
  const { status, valor_vencido, comissao_gerada, numero, orgao, objeto, data_abertura, valor_estimado,
          data_hora_abertura, operador_id, numero_controle_pncp, link_pncp } = req.body ?? {};

  const campos = [];
  const valores = [];
  let idx = 1;

  if (status          !== undefined) { campos.push(`status = $${idx++}`);          valores.push(status); }
  if (valor_vencido   !== undefined) { campos.push(`valor_vencido = $${idx++}`);   valores.push(parseFloat(valor_vencido) || null); }
  if (comissao_gerada !== undefined) { campos.push(`comissao_gerada = $${idx++}`); valores.push(parseFloat(comissao_gerada) || null); }
  if (numero          !== undefined) { campos.push(`numero = $${idx++}`);          valores.push(numero); }
  if (orgao           !== undefined) { campos.push(`orgao = $${idx++}`);           valores.push(orgao); }
  if (objeto          !== undefined) { campos.push(`objeto = $${idx++}`);          valores.push(objeto); }
  if (data_abertura       !== undefined) { campos.push(`data_abertura = $${idx++}`);       valores.push(data_abertura || null); }
  if (valor_estimado      !== undefined) { campos.push(`valor_estimado = $${idx++}`);      valores.push(parseFloat(valor_estimado) || null); }
  if (data_hora_abertura  !== undefined) {
    campos.push(`data_hora_abertura = $${idx++}`);
    valores.push(data_hora_abertura || null);
    // Reset alert flags so alerts fire again at the new time
    campos.push(`alerta_vespera_enviado = FALSE`);
    campos.push(`alerta_2h_enviado = FALSE`);
    campos.push(`alerta_1h_enviado = FALSE`);
  }
  if (operador_id           !== undefined) { campos.push(`operador_id = $${idx++}`);           valores.push(operador_id ? parseInt(operador_id) : null); }
  if (numero_controle_pncp !== undefined) { campos.push(`numero_controle_pncp = $${idx++}`); valores.push(numero_controle_pncp?.trim() || null); }
  if (link_pncp            !== undefined) { campos.push(`link_pncp = $${idx++}`);            valores.push(link_pncp?.trim() || null); }

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

async function remover(req, res) {
  const { id, pid } = req.params;
  try {
    const { rowCount } = await db.query(
      'DELETE FROM pregoes WHERE id = $1 AND cliente_id = $2',
      [pid, id],
    );
    if (rowCount === 0) return res.status(404).json({ erro: 'Pregão não encontrado' });
    return res.json({ mensagem: 'Pregão removido com sucesso' });
  } catch (erro) {
    console.error('Erro ao remover pregão:', erro);
    return res.status(500).json({ erro: 'Erro ao remover pregão' });
  }
}

module.exports = { listar, criar, atualizar, remover };
