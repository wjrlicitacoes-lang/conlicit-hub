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

  // Cache local de editais do PNCP — permite busca textual completa
  await db.query(`
    CREATE TABLE IF NOT EXISTS editais_cache (
      numero_controle_pncp  VARCHAR(100) PRIMARY KEY,
      orgao_cnpj            VARCHAR(20),
      orgao_nome            TEXT,
      objeto                TEXT,
      valor_estimado        NUMERIC,
      data_publicacao       DATE,
      data_encerramento     DATE,
      uf                    VARCHAR(2),
      municipio             VARCHAR(100),
      ano_compra            INTEGER,
      sequencial_compra     INTEGER,
      modalidade_nome       TEXT,
      raw                   JSONB,
      sincronizado_em       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_editais_cache_fts
      ON editais_cache
      USING GIN(to_tsvector('portuguese',
        coalesce(objeto,'') || ' ' || coalesce(orgao_nome,'')))
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_editais_cache_uf  ON editais_cache(uf)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_editais_cache_enc ON editais_cache(data_encerramento)`);

  console.log('Migrações executadas com sucesso');
}

module.exports = { executarMigracoes };
