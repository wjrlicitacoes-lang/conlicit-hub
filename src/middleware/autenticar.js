const jwt = require('jsonwebtoken');

function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token de acesso não informado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (erro) {
    const mensagem = erro.name === 'TokenExpiredError'
      ? 'Token expirado. Faça login novamente'
      : 'Token inválido';

    return res.status(401).json({ erro: mensagem });
  }
}

module.exports = autenticar;
