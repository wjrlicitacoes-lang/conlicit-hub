const db = require('../database/db');

async function verificarSaude(req, res) {
  let database_ok = false;
  let database_erro = null;

  try {
    await db.query('SELECT 1');
    database_ok = true;
  } catch (e) {
    database_erro = e.message;
  }

  res.json({
    status: 'ok',
    servico: 'ConlicitHub API',
    versao: '3.1.0',
    node: process.version,
    jwt_secret_configurada: !!process.env.JWT_SECRET,
    database_ok,
    ...(database_erro && { database_erro }),
    timestamp: new Date().toISOString(),
  });
}

module.exports = { verificarSaude };
