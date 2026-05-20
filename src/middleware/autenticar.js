const jwt = require('jsonwebtoken');
const db  = require('../database/db');

async function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token de acesso não informado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);

    // Tokens emitidos antes de role ser adicionado ao payload não têm req.usuario.role.
    // Fallback: busca role (e id) no banco para garantir retrocompatibilidade.
    if ((!req.usuario.role || req.usuario.cliente_id === undefined) && req.usuario.email) {
      const { rows } = await db.query(
        'SELECT id, role, cliente_id FROM usuarios WHERE email = $1',
        [req.usuario.email],
      );
      if (rows[0]) {
        req.usuario.id         = req.usuario.id   ?? rows[0].id;
        req.usuario.role       = req.usuario.role ?? rows[0].role;
        req.usuario.cliente_id = req.usuario.cliente_id ?? rows[0].cliente_id ?? null;
      }
    }

    next();
  } catch (erro) {
    const mensagem = erro.name === 'TokenExpiredError'
      ? 'Token expirado. Faça login novamente'
      : 'Token inválido';

    return res.status(401).json({ erro: mensagem });
  }
}

module.exports = autenticar;
