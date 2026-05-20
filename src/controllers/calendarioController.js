const db = require('../database/db');

async function listar(req, res) {
  const { mes, ano } = req.query;
  const agora = new Date();
  const mesNum = mes ? parseInt(mes, 10) : agora.getMonth() + 1;
  const anoNum = ano ? parseInt(ano, 10) : agora.getFullYear();

  try {
    const { rows } = await db.query(
      `SELECT
         p.id, p.cliente_id, p.numero, p.orgao, p.objeto,
         p.data_abertura, p.data_hora_abertura, p.valor_estimado, p.status,
         p.operador_id, p.alerta_vespera_enviado, p.alerta_2h_enviado, p.alerta_1h_enviado,
         c.nome AS cliente_nome,
         u.nome AS operador_nome,
         (
           SELECT COUNT(*) FROM pregoes p2
           WHERE p2.id <> p.id
             AND p2.data_hora_abertura IS NOT NULL
             AND p.data_hora_abertura IS NOT NULL
             AND ABS(EXTRACT(EPOCH FROM (p2.data_hora_abertura - p.data_hora_abertura))) < 3600
             AND p2.status = 'a_disputar'
         )::INTEGER AS conflitos
       FROM pregoes p
       JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN usuarios u ON u.id = p.operador_id
       WHERE p.status IN ('a_disputar','vencido','perdido','cancelado')
         AND (
           (p.data_hora_abertura IS NOT NULL
            AND EXTRACT(MONTH FROM p.data_hora_abertura AT TIME ZONE 'America/Sao_Paulo') = $1
            AND EXTRACT(YEAR  FROM p.data_hora_abertura AT TIME ZONE 'America/Sao_Paulo') = $2)
           OR
           (p.data_hora_abertura IS NULL
            AND p.data_abertura IS NOT NULL
            AND EXTRACT(MONTH FROM p.data_abertura) = $1
            AND EXTRACT(YEAR  FROM p.data_abertura) = $2)
         )
       ORDER BY COALESCE(p.data_hora_abertura, (p.data_abertura::TEXT || 'T12:00:00')::TIMESTAMPTZ) ASC`,
      [mesNum, anoNum],
    );
    return res.json({ total: rows.length, mes: mesNum, ano: anoNum, dados: rows });
  } catch (erro) {
    console.error('Erro ao listar calendário:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function definirHorario(req, res) {
  const { pid } = req.params;
  const { data_hora_abertura, operador_id } = req.body ?? {};

  const campos = [];
  const valores = [];
  let idx = 1;

  if (data_hora_abertura !== undefined) {
    campos.push(`data_hora_abertura = $${idx++}`);
    valores.push(data_hora_abertura || null);
    campos.push(`alerta_vespera_enviado = FALSE`);
    campos.push(`alerta_2h_enviado = FALSE`);
    campos.push(`alerta_1h_enviado = FALSE`);
  }
  if (operador_id !== undefined) {
    campos.push(`operador_id = $${idx++}`);
    valores.push(operador_id ? parseInt(operador_id, 10) : null);
  }

  if (campos.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });

  valores.push(pid);
  try {
    const { rows } = await db.query(
      `UPDATE pregoes SET ${campos.join(', ')} WHERE id = $${idx} RETURNING *`,
      valores,
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Pregão não encontrado' });
    return res.json(rows[0]);
  } catch (erro) {
    console.error('Erro ao atualizar pregão (calendário):', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listar, definirHorario };
