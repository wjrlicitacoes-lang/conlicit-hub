// Garante que um usuário com role='cliente' só acesse dados do seu próprio cliente_id
function protegerCliente(req, res, next) {
  if (req.usuario.role === 'cliente') {
    const cid = parseInt(req.params.id, 10);
    if (!req.usuario.cliente_id || cid !== req.usuario.cliente_id) {
      return res.status(403).json({ erro: 'Acesso negado' });
    }
  }
  next();
}

module.exports = protegerCliente;
