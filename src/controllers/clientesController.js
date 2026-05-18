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

module.exports = { cadastrar, listar };
