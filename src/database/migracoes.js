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
      id                   SERIAL PRIMARY KEY,
      nome                 VARCHAR(255) NOT NULL,
      email                VARCHAR(255) UNIQUE NOT NULL,
      whatsapp             VARCHAR(20),
      palavras_chave       TEXT[]       NOT NULL DEFAULT '{}',
      uf                   VARCHAR(2),
      ativo                BOOLEAN      NOT NULL DEFAULT TRUE,
      valor_contrato       NUMERIC      NOT NULL DEFAULT 0,
      percentual_comissao  NUMERIC      NOT NULL DEFAULT 0,
      dia_vencimento       INTEGER      NOT NULL DEFAULT 1,
      criado_em            TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  // Adiciona colunas novas a tabelas que já podem existir sem elas
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS valor_contrato       NUMERIC      NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS percentual_comissao  NUMERIC      NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dia_vencimento       INTEGER      NOT NULL DEFAULT 1`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS responsavel          VARCHAR(255)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS origem               VARCHAR(50)  NOT NULL DEFAULT 'direto'`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS sdr_nome             VARCHAR(255)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS sdr_comissao         NUMERIC      NOT NULL DEFAULT 0`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS pregoes (
      id              SERIAL PRIMARY KEY,
      cliente_id      INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      numero          VARCHAR(100),
      orgao           TEXT,
      objeto          TEXT,
      data_abertura   DATE,
      valor_estimado  NUMERIC,
      valor_vencido   NUMERIC,
      comissao_gerada NUMERIC,
      status          VARCHAR(20) NOT NULL DEFAULT 'a_disputar',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT pregoes_status_check CHECK (status IN ('a_disputar','vencido','perdido','cancelado'))
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS mensalidades (
      id                SERIAL PRIMARY KEY,
      cliente_id        INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      mes_ano           VARCHAR(7)  NOT NULL,
      valor             NUMERIC     NOT NULL DEFAULT 0,
      data_vencimento   DATE,
      data_recebimento  DATE,
      status            VARCHAR(20) NOT NULL DEFAULT 'pendente',
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT mensalidades_status_check CHECK (status IN ('recebido','pendente','atrasado'))
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS documentos (
      id              SERIAL PRIMARY KEY,
      cliente_id      INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      nome            TEXT        NOT NULL,
      tipo            VARCHAR(50) DEFAULT 'outro',
      url             TEXT,
      data_vencimento DATE,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Cache local de editais do PNCP
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

  // Calendário de pregões
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS data_hora_abertura     TIMESTAMPTZ`);
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS operador_id             INTEGER REFERENCES usuarios(id)`);
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS alerta_vespera_enviado  BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS alerta_2h_enviado       BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS alerta_1h_enviado       BOOLEAN NOT NULL DEFAULT FALSE`);

  // Campos de contato e responsabilidade no cliente
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS contato_nome       VARCHAR(255)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS contato_cargo      VARCHAR(100)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS contato_whatsapp   VARCHAR(20)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS responsavel_conlicit VARCHAR(100)`);

  // Sistema de roles
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome VARCHAR(255)`);
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'assistente' CHECK (role IN ('admin','assistente'))`);
  await db.query(`UPDATE usuarios SET role = 'admin' WHERE email = 'wjrlicitacoes@gmail.com'`);

  // Edson — análise de IA por pregão
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS numero_controle_pncp VARCHAR(100)`);
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS link_pncp TEXT`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS analises_edson (
      id                  SERIAL PRIMARY KEY,
      pregao_id           INTEGER REFERENCES pregoes(id) ON DELETE CASCADE UNIQUE,
      status              VARCHAR(20) NOT NULL DEFAULT 'processando',
      score               INTEGER,
      score_justificativa TEXT,
      resumo_executivo    TEXT,
      modalidade          VARCHAR(100),
      modo_disputa        VARCHAR(100),
      tipo_julgamento     VARCHAR(100),
      itens               JSONB NOT NULL DEFAULT '[]',
      habilitacao         JSONB NOT NULL DEFAULT '[]',
      riscos              JSONB NOT NULL DEFAULT '[]',
      checklist           JSONB NOT NULL DEFAULT '{"antes":[],"durante":[]}',
      erro_mensagem       TEXT,
      criado_em           TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_edson (
      id          SERIAL PRIMARY KEY,
      analise_id  INTEGER REFERENCES analises_edson(id) ON DELETE CASCADE,
      role        VARCHAR(10) NOT NULL,
      content     TEXT NOT NULL,
      criado_em   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Role cliente — terceiro role com acesso restrito
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL`);

  // Expandir CHECK de role para incluir 'cliente' — drop + recreate idempotente
  await db.query(`
    DO $$
    BEGIN
      -- Remove qualquer constraint de role existente (com ou sem 'cliente')
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'usuarios' AND constraint_name = 'usuarios_role_check'
      ) THEN
        ALTER TABLE usuarios DROP CONSTRAINT usuarios_role_check;
      END IF;
      -- Recria sempre com os três roles
      ALTER TABLE usuarios ADD CONSTRAINT usuarios_role_check
        CHECK (role IN ('admin','assistente','cliente'));
    END $$
  `);

  // Status 'oferta' no fluxo de duas etapas (admin oferece → cliente aceita/rejeita)
  await db.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.check_constraints cc ON cc.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'pregoes' AND tc.constraint_type = 'CHECK'
          AND cc.check_clause ILIKE '%status%'
          AND tc.constraint_name NOT LIKE '%not_null%'
      LOOP
        BEGIN
          EXECUTE 'ALTER TABLE pregoes DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END LOOP;
    END $$
  `);
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE check_clause ILIKE '%oferta%' AND constraint_name ILIKE '%status%'
      ) THEN
        ALTER TABLE pregoes ADD CONSTRAINT pregoes_status_check
          CHECK (status IN ('a_disputar','vencido','perdido','cancelado','oferta'));
      END IF;
    END $$
  `);

  // Portal de disputa no pregão
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS portal_disputa VARCHAR(100)`);

  // Edson: análise avulsa (sem pregão vinculado) + rubrica de score
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS referencia TEXT`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS criterios_score JSONB`);

  // Vincular análise avulsa diretamente a um cliente
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL`);

  // Dashboard: pregões vencidos com status de contrato
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS contrato_assinado BOOLEAN NOT NULL DEFAULT FALSE`);

  // Prospects (pipeline comercial)
  await db.query(`
    CREATE TABLE IF NOT EXISTS prospects (
      id           SERIAL PRIMARY KEY,
      nome         VARCHAR(255) NOT NULL,
      email        VARCHAR(255),
      whatsapp     VARCHAR(20),
      empresa      VARCHAR(255),
      segmento     VARCHAR(100),
      status       VARCHAR(50) NOT NULL DEFAULT 'em_negociacao',
      notas        TEXT,
      responsavel  VARCHAR(100),
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT prospects_status_check CHECK (status IN ('em_negociacao','proposta_enviada','aguardando','convertido','perdido'))
    )
  `);

  // Renomear status 'oferta' → 'sugerido' (abordagem idempotente)
  // 1. Drop direto com IF EXISTS (seguro se não existir)
  await db.query(`
    DO $$ BEGIN
      ALTER TABLE pregoes DROP CONSTRAINT IF EXISTS pregoes_status_check;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$
  `);
  // 2. Migrar dados: oferta → sugerido; qualquer outro inválido → a_disputar
  await db.query(`UPDATE pregoes SET status = 'sugerido' WHERE status = 'oferta'`);
  await db.query(`
    UPDATE pregoes SET status = 'a_disputar'
    WHERE status NOT IN ('a_disputar','vencido','perdido','cancelado','sugerido')
  `);
  // 3. Recriar constraint — ignora se já existir
  await db.query(`
    DO $$ BEGIN
      ALTER TABLE pregoes ADD CONSTRAINT pregoes_status_check
        CHECK (status IN ('a_disputar','vencido','perdido','cancelado','sugerido'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  console.log('Migrações executadas com sucesso');
}

module.exports = { executarMigracoes };
