function verificarSaude(req, res) {
  res.json({
    status: 'ok',
    servico: 'ConlicitHub API',
    versao: '3.1.0',
    node: process.version,
    jwt_secret_configurada: !!process.env.JWT_SECRET,
    database_ok: !!process.env.DATABASE_URL,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { verificarSaude };
