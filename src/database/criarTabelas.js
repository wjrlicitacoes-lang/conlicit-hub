const db = require('./db');

async function criar() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS oportunidades_fila (
      id                   SERIAL PRIMARY KEY,
      edital_ref           VARCHAR(255),
      numero_controle_pncp VARCHAR(100),
      orgao                TEXT,
      objeto               TEXT,
      valor_estimado       NUMERIC,
      data_abertura        TIMESTAMPTZ,
      link_pncp            TEXT,
      link_edital          TEXT,
      portal               VARCHAR(100),
      municipio            VARCHAR(100),
      uf                   CHAR(2),
      cliente_id           INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      criado_por           INTEGER REFERENCES usuarios(id),
      pregao_id            INTEGER,
      status               VARCHAR(30) NOT NULL DEFAULT 'aguardando_analise',
      resumo_edson         JSONB,
      resumo_gerado_em     TIMESTAMPTZ,
      disparado_em         TIMESTAMPTZ,
      resposta_cliente     VARCHAR(20),
      resposta_em          TIMESTAMPTZ,
      cobranca_1_em        TIMESTAMPTZ,
      cobranca_2_em        TIMESTAMPTZ,
      created_at           TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_op_cliente ON oportunidades_fila(cliente_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_op_status ON oportunidades_fila(status)`);
  console.log('Tabela oportunidades_fila criada');
  process.exit(0);
}

criar().catch(e => { console.error(e.message); process.exit(1); });
