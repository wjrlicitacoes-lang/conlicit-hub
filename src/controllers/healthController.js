function verificarSaude(req, res) {
  res.json({
    status: 'ok',
    servico: 'ConlicitHub API',
    versao: '3.1.0',
    node: process.version,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { verificarSaude };
