function verificarSaude(req, res) {
  res.json({
    status: 'ok',
    servico: 'ConlicitHub API',
    timestamp: new Date().toISOString(),
  });
}

module.exports = { verificarSaude };
