const db = require('../database/db');

async function cadastrar(req, res) {
  const { nome, email, whatsapp, palavras_chave, uf, ativo } = req.body ?? {};

  if (!nome || !email) {
    return res.status(400).json({ erro: 'nome e email são obrigatórios' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'Email inválido' });
  }
  if (palavras_chave !== undefined && !Array.isArray(palavras_chave)) {
    return res.status(400).json({ erro: 'palavras_chave deve ser um array de strings' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO clientes (nome, email, whatsapp, palavras_chave, uf, ativo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nome, email, whatsapp, palavras_chave, uf, ativo, criado_em`,
      [
        nome.trim(),
        email.trim().toLowerCase(),
        whatsapp?.replace(/\D/g, '') || null,
        palavras_chave ?? [],
        uf?.toUpperCase() || null,
        ativo !== undefined ? ativo : true,
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
    const condicao = ativo !== undefined ? 'WHERE ativo = $1' : '';
    const params = ativo !== undefined ? [ativo === 'true'] : [];
    const { rows } = await db.query(
      `SELECT id, nome, email, whatsapp, palavras_chave, uf, ativo, criado_em
       FROM clientes ${condicao} ORDER BY criado_em DESC`,
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
  const { nome, email, whatsapp, palavras_chave, uf, ativo } = req.body ?? {};

  if (palavras_chave !== undefined && !Array.isArray(palavras_chave)) {
    return res.status(400).json({ erro: 'palavras_chave deve ser um array de strings' });
  }

  const campos = [];
  const valores = [];
  let idx = 1;

  if (nome !== undefined)           { campos.push(`nome = $${idx++}`);           valores.push(nome.trim()); }
  if (email !== undefined)          { campos.push(`email = $${idx++}`);          valores.push(email.trim().toLowerCase()); }
  if (whatsapp !== undefined)       { campos.push(`whatsapp = $${idx++}`);       valores.push(whatsapp?.replace(/\D/g, '') || null); }
  if (palavras_chave !== undefined) { campos.push(`palavras_chave = $${idx++}`); valores.push(palavras_chave); }
  if (uf !== undefined)             { campos.push(`uf = $${idx++}`);             valores.push(uf?.toUpperCase() || null); }
  if (ativo !== undefined)          { campos.push(`ativo = $${idx++}`);          valores.push(ativo); }

  if (campos.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });

  valores.push(id);
  try {
    const { rows } = await db.query(
      `UPDATE clientes SET ${campos.join(', ')} WHERE id = $${idx}
       RETURNING id, nome, email, whatsapp, palavras_chave, uf, ativo, criado_em`,
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

module.exports = { cadastrar, listar, atualizar };
