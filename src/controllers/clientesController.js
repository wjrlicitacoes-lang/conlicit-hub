const db = require('../database/db');

// SELECT base com agregações de pregões
const SELECT_CLIENTES = `
  SELECT
    c.id, c.nome, c.email, c.whatsapp, c.palavras_chave, c.uf, c.ativo, c.criado_em,
    c.valor_contrato, c.percentual_comissao, c.dia_vencimento,
    c.responsavel, c.origem, c.sdr_nome, c.sdr_comissao,
    c.contato_nome, c.contato_cargo, c.contato_whatsapp, c.responsavel_conlicit,
    COALESCE(SUM(CASE WHEN p.status = 'vencido' THEN p.comissao_gerada ELSE 0 END), 0)::NUMERIC AS comissao_total,
    COALESCE(SUM(CASE WHEN p.status = 'vencido' THEN p.valor_vencido   ELSE 0 END), 0)::NUMERIC AS valor_vencido_total,
    COUNT(CASE WHEN p.status = 'a_disputar' THEN 1 END)::INTEGER AS pregoes_a_disputar,
    COUNT(CASE WHEN p.status = 'vencido'    THEN 1 END)::INTEGER AS pregoes_vencidos,
    COUNT(CASE WHEN p.status = 'perdido'    THEN 1 END)::INTEGER AS pregoes_perdidos
  FROM clientes c
  LEFT JOIN pregoes p ON p.cliente_id = c.id
`;

async function cadastrar(req, res) {
  const { nome, email, whatsapp, palavras_chave, uf, ativo,
          valor_contrato, percentual_comissao, dia_vencimento,
          responsavel, origem, sdr_nome, sdr_comissao,
          contato_nome, contato_cargo, contato_whatsapp, responsavel_conlicit } = req.body ?? {};

  if (!nome || !email)
    return res.status(400).json({ erro: 'nome e email são obrigatórios' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ erro: 'Email inválido' });
  if (palavras_chave !== undefined && !Array.isArray(palavras_chave))
    return res.status(400).json({ erro: 'palavras_chave deve ser um array de strings' });

  try {
    const { rows } = await db.query(
      `INSERT INTO clientes
         (nome, email, whatsapp, palavras_chave, uf, ativo, valor_contrato, percentual_comissao,
          dia_vencimento, responsavel, origem, sdr_nome, sdr_comissao,
          contato_nome, contato_cargo, contato_whatsapp, responsavel_conlicit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, nome, email, whatsapp, palavras_chave, uf, ativo, criado_em,
                 valor_contrato, percentual_comissao, dia_vencimento,
                 responsavel, origem, sdr_nome, sdr_comissao,
                 contato_nome, contato_cargo, contato_whatsapp, responsavel_conlicit`,
      [
        nome.trim(),
        email.trim().toLowerCase(),
        whatsapp?.replace(/\D/g, '') || null,
        palavras_chave ?? [],
        uf?.toUpperCase() || null,
        ativo !== undefined ? ativo : true,
        parseFloat(valor_contrato) || 0,
        parseFloat(percentual_comissao) || 0,
        parseInt(dia_vencimento) || 1,
        responsavel?.trim() || null,
        origem || 'direto',
        sdr_nome?.trim() || null,
        parseFloat(sdr_comissao) || 0,
        contato_nome?.trim() || null,
        contato_cargo?.trim() || null,
        contato_whatsapp?.replace(/\D/g, '') || null,
        responsavel_conlicit?.trim() || null,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Email já cadastrado' });
    console.error('Erro ao cadastrar cliente:', erro);
    return res.status(500).json({ erro: 'Erro interno ao cadastrar cliente' });
  }
}

async function listar(req, res) {
  const { ativo } = req.query;
  try {
    const condicao = ativo !== undefined ? 'WHERE c.ativo = $1' : '';
    const params   = ativo !== undefined ? [ativo === 'true'] : [];
    const { rows } = await db.query(
      `${SELECT_CLIENTES} ${condicao} GROUP BY c.id ORDER BY c.criado_em DESC`,
      params,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (erro) {
    console.error('Erro ao listar clientes:', erro);
    return res.status(500).json({ erro: 'Erro interno ao listar clientes' });
  }
}

async function atualizar(req, res) {
  const { id } = req.params;
  const { nome, email, whatsapp, palavras_chave, uf, ativo,
          valor_contrato, percentual_comissao, dia_vencimento,
          responsavel, origem, sdr_nome, sdr_comissao,
          contato_nome, contato_cargo, contato_whatsapp, responsavel_conlicit } = req.body ?? {};

  if (palavras_chave !== undefined && !Array.isArray(palavras_chave))
    return res.status(400).json({ erro: 'palavras_chave deve ser um array de strings' });

  const campos = [];
  const valores = [];
  let idx = 1;

  if (nome               !== undefined) { campos.push(`nome = $${idx++}`);               valores.push(nome.trim()); }
  if (email              !== undefined) { campos.push(`email = $${idx++}`);              valores.push(email.trim().toLowerCase()); }
  if (whatsapp           !== undefined) { campos.push(`whatsapp = $${idx++}`);           valores.push(whatsapp?.replace(/\D/g, '') || null); }
  if (palavras_chave     !== undefined) { campos.push(`palavras_chave = $${idx++}`);     valores.push(palavras_chave); }
  if (uf                 !== undefined) { campos.push(`uf = $${idx++}`);                 valores.push(uf?.toUpperCase() || null); }
  if (ativo              !== undefined) { campos.push(`ativo = $${idx++}`);              valores.push(ativo); }
  if (valor_contrato     !== undefined) { campos.push(`valor_contrato = $${idx++}`);     valores.push(parseFloat(valor_contrato) || 0); }
  if (percentual_comissao !== undefined) { campos.push(`percentual_comissao = $${idx++}`); valores.push(parseFloat(percentual_comissao) || 0); }
  if (dia_vencimento     !== undefined) { campos.push(`dia_vencimento = $${idx++}`);     valores.push(parseInt(dia_vencimento) || 1); }
  if (responsavel        !== undefined) { campos.push(`responsavel = $${idx++}`);        valores.push(responsavel?.trim() || null); }
  if (origem             !== undefined) { campos.push(`origem = $${idx++}`);             valores.push(origem || 'direto'); }
  if (sdr_nome           !== undefined) { campos.push(`sdr_nome = $${idx++}`);           valores.push(sdr_nome?.trim() || null); }
  if (sdr_comissao          !== undefined) { campos.push(`sdr_comissao = $${idx++}`);           valores.push(parseFloat(sdr_comissao) || 0); }
  if (contato_nome          !== undefined) { campos.push(`contato_nome = $${idx++}`);           valores.push(contato_nome?.trim() || null); }
  if (contato_cargo         !== undefined) { campos.push(`contato_cargo = $${idx++}`);          valores.push(contato_cargo?.trim() || null); }
  if (contato_whatsapp      !== undefined) { campos.push(`contato_whatsapp = $${idx++}`);       valores.push(contato_whatsapp?.replace(/\D/g, '') || null); }
  if (responsavel_conlicit  !== undefined) { campos.push(`responsavel_conlicit = $${idx++}`);   valores.push(responsavel_conlicit?.trim() || null); }

  if (campos.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });

  valores.push(id);
  try {
    const { rows } = await db.query(
      `UPDATE clientes SET ${campos.join(', ')} WHERE id = $${idx}
       RETURNING id, nome, email, whatsapp, palavras_chave, uf, ativo, criado_em,
                 valor_contrato, percentual_comissao, dia_vencimento,
                 responsavel, origem, sdr_nome, sdr_comissao,
                 contato_nome, contato_cargo, contato_whatsapp, responsavel_conlicit`,
      valores,
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Cliente não encontrado' });
    return res.json(rows[0]);
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Email já cadastrado' });
    console.error('Erro ao atualizar cliente:', erro);
    return res.status(500).json({ erro: 'Erro interno ao atualizar cliente' });
  }
}

async function stats(req, res) {
  try {
    const mesAtual = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const { rows: [s] } = await db.query(
      `SELECT
         COUNT(c.id)::INTEGER                                     AS total_clientes,
         COUNT(c.id) FILTER (WHERE c.ativo)::INTEGER              AS clientes_ativos,
         COALESCE(SUM(c.valor_contrato) FILTER (WHERE c.ativo), 0) AS mrr,
         (SELECT COUNT(*)::INTEGER       FROM pregoes WHERE status = 'vencido')           AS pregoes_vencidos_total,
         (SELECT COALESCE(SUM(valor_vencido), 0) FROM pregoes WHERE status = 'vencido')   AS valor_vencido_total,
         (SELECT COALESCE(SUM(valor), 0) FROM mensalidades WHERE mes_ano = $1 AND status = 'pendente') AS comissoes_mes_pendentes,
         (SELECT COALESCE(SUM(valor_contrato * sdr_comissao / 100), 0)
          FROM clientes WHERE ativo = TRUE AND origem = 'indicacao') AS comissoes_sdr_mes
       FROM clientes c`,
      [mesAtual],
    );
    return res.json(s);
  } catch (erro) {
    console.error('Erro ao buscar stats:', erro);
    return res.status(500).json({ erro: 'Erro ao buscar estatísticas' });
  }
}

module.exports = { cadastrar, listar, atualizar, stats };
