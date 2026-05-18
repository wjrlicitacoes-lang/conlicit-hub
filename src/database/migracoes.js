const db = require('./db');

async function executarMigracoes() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         SERIAL PRIMARY KEY,
      email      VARCHAR(255) UNIQUE NOT NULL,
      senha_hash VARCHAR(255) NOT NULL,
      criado_em  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id             SERIAL PRIMARY KEY,
      nome           VARCHAR(255) NOT NULL,
      email          VARCHAR(255) UNIQUE NOT NULL,
      whatsapp       VARCHAR(20),
      palavras_chave TEXT[]       NOT NULL DEFAULT '{}',
      uf             VARCHAR(2),
      ativo          BOOLEAN      NOT NULL DEFAULT TRUE,
      criado_em      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  console.log('Migrações executadas com sucesso');
}

module.exports = { executarMigracoes };
