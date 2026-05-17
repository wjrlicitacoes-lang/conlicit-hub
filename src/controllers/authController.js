const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Armazenamento em memória — substituir por banco de dados em produção
const usuarios = new Map();

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

  if (usuarios.has(email)) {
    return res.status(409).json({ erro: 'Email já cadastrado' });
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  usuarios.set(email, { email, senhaHash });

  return res.status(201).json({ mensagem: 'Usuário criado com sucesso' });
}

async function login(req, res) {
  const { email, senha } = req.body ?? {};

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios' });
  }

  try {
    const usuario = usuarios.get(email);
    const senhaValida = usuario && await bcrypt.compare(senha, usuario.senhaHash);

    // Mesma mensagem para usuário inexistente e senha errada (evita enumeração)
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
    return res.status(500).json({ erro: 'Erro interno ao processar login' });
  }
}

module.exports = { registrar, login };
