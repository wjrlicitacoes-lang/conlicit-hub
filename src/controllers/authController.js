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
      'SELECT id, email, senha_hash, role, cliente_id FROM usuarios WHERE email = $1',
      [email.trim().toLowerCase()],
    );

    const usuario = resultado.rows[0];
    const senhaValida = usuario && await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida)
      return res.status(401).json({ erro: 'Credenciais inválidas' });

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, role: usuario.role, cliente_id: usuario.cliente_id ?? null },
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
  return res.json({
    id: req.usuario.id,
    email: req.usuario.email,
    role: req.usuario.role,
    cliente_id: req.usuario.cliente_id ?? null,
  });
}

const SENHA_PADRAO = 'Conlicit@2024';

async function criarUsuario(req, res) {
  if (req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Acesso negado' });

  const { nome, email, role, cliente_id } = req.body ?? {};
  let { senha } = req.body ?? {};

  if (!email)
    return res.status(400).json({ erro: 'Email é obrigatório' });
  if (!['admin', 'assistente', 'cliente'].includes(role))
    return res.status(400).json({ erro: 'Role inválido (use admin, assistente ou cliente)' });
  if (role === 'cliente' && !cliente_id)
    return res.status(400).json({ erro: 'cliente_id é obrigatório para o role cliente' });

  const senhaGerada = !senha;
  if (senhaGerada) senha = SENHA_PADRAO;
  if (senha.length < 6)
    return res.status(400).json({ erro: 'Senha deve ter no mínimo 6 caracteres' });

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const cid = role === 'cliente' ? parseInt(cliente_id, 10) : null;
    const { rows } = await db.query(
      `INSERT INTO usuarios (nome, email, senha_hash, role, cliente_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, email, role, cliente_id, criado_em`,
      [nome?.trim() || null, email.trim().toLowerCase(), senhaHash, role, cid],
    );
    return res.status(201).json({
      ...rows[0],
      ...(senhaGerada ? { senha_provisoria: senha } : {}),
    });
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
      `SELECT u.id, u.nome, u.email, u.role, u.cliente_id, u.criado_em,
              c.nome AS cliente_nome
       FROM usuarios u
       LEFT JOIN clientes c ON c.id = u.cliente_id
       ORDER BY u.criado_em DESC`,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (erro) {
    console.error('Erro ao listar usuários:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function editarUsuario(req, res) {
  if (req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Acesso negado' });

  const { id } = req.params;
  const { nome, email, role, cliente_id } = req.body ?? {};

  if (role && !['admin', 'assistente', 'cliente'].includes(role))
    return res.status(400).json({ erro: 'Role inválido' });

  try {
    const campos = [];
    const valores = [];
    let idx = 1;
    if (nome !== undefined)  { campos.push(`nome = $${idx++}`);      valores.push(nome?.trim() || null); }
    if (email !== undefined) { campos.push(`email = $${idx++}`);     valores.push(email.trim().toLowerCase()); }
    if (role !== undefined)  { campos.push(`role = $${idx++}`);      valores.push(role); }
    if (cliente_id !== undefined) { campos.push(`cliente_id = $${idx++}`); valores.push(cliente_id ? parseInt(cliente_id, 10) : null); }
    if (campos.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
    valores.push(id);
    const { rows } = await db.query(
      `UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${idx} RETURNING id, nome, email, role, cliente_id`,
      valores,
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado' });
    return res.json(rows[0]);
  } catch (erro) {
    if (erro.code === '23505') return res.status(409).json({ erro: 'Email já em uso' });
    console.error('Erro ao editar usuário:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function excluirUsuario(req, res) {
  if (req.usuario.role !== 'admin')
    return res.status(403).json({ erro: 'Acesso negado' });

  const { id } = req.params;
  if (parseInt(id, 10) === req.usuario.id)
    return res.status(400).json({ erro: 'Não é possível excluir sua própria conta' });

  try {
    const { rowCount } = await db.query('DELETE FROM usuarios WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ erro: 'Usuário não encontrado' });
    return res.json({ mensagem: 'Usuário excluído' });
  } catch (erro) {
    console.error('Erro ao excluir usuário:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { registrar, login, me, criarUsuario, listarUsuarios, editarUsuario, excluirUsuario };
