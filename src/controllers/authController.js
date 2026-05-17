const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');

async function registrar(req, res) {
  const { email, senha } = req.body ?? {};

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'Email inválido' });
  }

  if (senha.length < 8) {
    return res.status(400).json({ erro: 'A senha deve ter no mínimo 8 caracteres' });
  }

  try {
    const senhaHash = await bcrypt.hash(senha, 10);

    await db.query(
      'INSERT INTO usuarios (email, senha_hash) VALUES ($1, $2)',
      [email, senhaHash],
    );

    return res.status(201).json({ mensagem: 'Usuário criado com sucesso' });
  } catch (erro) {
    // Código 23505 = violação de unique constraint (email duplicado)
    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Email já cadastrado' });
    }
    console.error('Erro ao registrar usuário:', erro);
    return res.status(500).json({ erro: 'Erro interno ao criar usuário' });
  }
}

async function login(req, res) {
  const { email, senha } = req.body ?? {};

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
  }

  try {
    const resultado = await db.query(
      'SELECT email, senha_hash FROM usuarios WHERE email = $1',
      [email],
    );

    const usuario = resultado.rows[0];

    // Mesma mensagem para usuário inexistente e senha errada (evita enumeração)
    const senhaValida = usuario && await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) {
      return res.status(401).json({ erro: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { email: usuario.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRACAO || '8h' },
    );

    return res.json({ token });
  } catch (erro) {
    console.error('Erro ao fazer login:', erro);
    return res.status(500).json({ erro: 'Erro interno ao processar login' });
  }
}

module.exports = { registrar, login };
