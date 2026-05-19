const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');

async function registrar(req, res) {
  const { email, senha } = req.body ?? {};

  if (!email || !senha)
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ erro: 'Email inválido' });
  if (senha.length < 8)
    return res.status(400).json({ erro: 'A senha deve ter no mínimo 8 caracteres' });

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    await db.query(
      'INSERT INTO usuarios (email, senha_hash) VALUES ($1, $2)',
      [email.trim().toLowerCase(), senhaHash],
    );
    return res.status(201).json({ mensagem: 'Usuário criado com sucesso' });
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Email já cadastrado' });
    console.error('Erro ao registrar usuário:', erro);
    return res.status(500).json({ erro: 'Erro interno ao criar usuário' });
  }
}

async function login(req, res) {
  const { email, senha } = req.body ?? {};

  if (!email || !senha)
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });

  try {
    const resultado = await db.query(
      'SELECT id, email, senha_hash, role FROM usuarios WHERE email = $1',
      [email.trim().toLowerCase()],
    );

    const usuario = resultado.rows[0];
    const senhaValida = usuario && await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida)
      return res.status(401).json({ erro: 'Credenciais inválidas' });

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, role: usuario.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRACAO || '8h' },
    );

    return res.json({ token });
  } catch (erro) {
    console.error('Erro ao fazer login:', erro);
    return res.status(500).json({ erro: 'Erro interno ao processar login' });
  }
}

function me(req, res) {
  return res.json({ id: req.usuario.id, email: req.usuario.email, role: req.usuario.role });
}

async function criarUsuario(req, res) {
  if (req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Acesso negado' });

  const { nome, email, senha, role } = req.body ?? {};
  if (!email || !senha)
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
  if (!['admin', 'assistente'].includes(role))
    return res.status(400).json({ erro: 'Role inválido (use admin ou assistente)' });
  if (senha.length < 6)
    return res.status(400).json({ erro: 'Senha deve ter no mínimo 6 caracteres' });

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const { rows } = await db.query(
      `INSERT INTO usuarios (nome, email, senha_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nome, email, role, criado_em`,
      [nome?.trim() || null, email.trim().toLowerCase(), senhaHash, role],
    );
    return res.status(201).json(rows[0]);
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Email já cadastrado' });
    console.error('Erro ao criar usuário:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function listarUsuarios(req, res) {
  if (req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Acesso negado' });

  try {
    const { rows } = await db.query(
      'SELECT id, nome, email, role, criado_em FROM usuarios ORDER BY criado_em DESC',
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (erro) {
    console.error('Erro ao listar usuários:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { registrar, login, me, criarUsuario, listarUsuarios };
