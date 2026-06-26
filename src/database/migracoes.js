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
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'assistente'`);
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

  // Garantir que não existe constraint de role (validação é feita no código)
  await db.query(`ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check`);

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
    EXCEPTION WHEN OTHERS THEN
      NULL; -- ignora se rows existentes violarem (serão corrigidas pelo step seguinte)
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

  // Suplementos de análise — imagem PNCP e documento complementar
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS imagem_pncp_base64        TEXT`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS arquivo_complementar_texto TEXT`);

  // Resumo de oportunidade — campos extraídos do edital pelo Edson
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS tipo_fornecimento      VARCHAR(20)`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS entrega_tipo           VARCHAR(20)`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS julgamento_tipo        VARCHAR(20)`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS locais_entrega         TEXT`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS prazo_entrega          TEXT`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS habilitacao_juridica_json JSONB`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS habilitacao_economica_json JSONB`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS capacidade_tecnica_json   JSONB`);

  await db.query(`ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check`);

  // Tabela de propostas comerciais
  await db.query(`
    CREATE TABLE IF NOT EXISTS propostas (
      id                  SERIAL PRIMARY KEY,
      numero              VARCHAR(20) NOT NULL,
      cliente             VARCHAR(255),
      responsavel         VARCHAR(100),
      valor_mensalidade   DECIMAL(10,2),
      percentual_comissao DECIMAL(5,2),
      dados_json          JSONB,
      criado_por          INTEGER REFERENCES usuarios(id),
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Controle granular de acesso por módulo
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuario_permissoes (
      id           SERIAL PRIMARY KEY,
      usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      modulo       VARCHAR(50) NOT NULL,
      liberado     BOOLEAN DEFAULT TRUE,
      alterado_por INTEGER REFERENCES usuarios(id),
      alterado_em  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(usuario_id, modulo)
    )
  `);

  await db.query(`ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check`);

  // Novos campos Edson — Lei 14.133/2021
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS clausulas_restritivas JSONB DEFAULT '[]'`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS prazos_legais JSONB DEFAULT '{}'`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS beneficios_me_epp JSONB DEFAULT '{}'`);

  // Ampliar campos VARCHAR(100) que truncam respostas do Edson
  await db.query(`ALTER TABLE analises_edson ALTER COLUMN modalidade TYPE TEXT`);
  await db.query(`ALTER TABLE analises_edson ALTER COLUMN modo_disputa TYPE TEXT`);
  await db.query(`ALTER TABLE analises_edson ALTER COLUMN tipo_julgamento TYPE TEXT`);
  await db.query(`ALTER TABLE analises_edson ALTER COLUMN status TYPE TEXT`);

  // WhatsApp grupo nos clientes (para disparo de oportunidades)
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS whatsapp_grupo VARCHAR(100)`);

  // ── Fila de oportunidades ────────────────────────────────────────────
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
      status               VARCHAR(30) NOT NULL DEFAULT 'aguardando_analise'
                           CHECK (status IN (
                             'aguardando_analise',
                             'aguardando_disparo',
                             'disparado',
                             'interesse_confirmado',
                             'sem_interesse',
                             'expirado'
                           )),
      resumo_edson         JSONB,
      resumo_gerado_em     TIMESTAMPTZ,
      disparado_em         TIMESTAMPTZ,
      resposta_cliente     VARCHAR(20),
      resposta_em          TIMESTAMPTZ,
      cobranca_1_em        TIMESTAMPTZ,
      cobranca_2_em        TIMESTAMPTZ,
      pregao_id            INTEGER REFERENCES pregoes(id) ON DELETE SET NULL,
      created_at           TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_oportunidades_cliente ON oportunidades_fila(cliente_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_oportunidades_status ON oportunidades_fila(status)`);
  await db.query(`ALTER TABLE oportunidades_fila ADD COLUMN IF NOT EXISTS pregao_id INTEGER REFERENCES pregoes(id) ON DELETE SET NULL`);
  await db.query(`ALTER TABLE oportunidades_fila ADD COLUMN IF NOT EXISTS operador_id INTEGER REFERENCES usuarios(id)`);
  await db.query(`ALTER TABLE oportunidades_fila ADD COLUMN IF NOT EXISTS operador_obs TEXT`);

  await db.query(`ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check`);

  // Colunas de operador nos pregões
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS operador_obs TEXT`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_pregoes_operador ON pregoes(operador_id)`);

  // updated_at em pregoes — necessário para ordenação correta no dashboard
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
  await db.query(`
    UPDATE pregoes SET updated_at = created_at WHERE updated_at IS NULL
  `);


  // Adicionar 'novo_lead' ao status de prospects (formulário público)
  await db.query(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_status_check;
      EXCEPTION WHEN others THEN NULL;
      END;
      BEGIN
        ALTER TABLE prospects ADD CONSTRAINT prospects_status_check
          CHECK (status IN ('novo_lead','em_negociacao','proposta_enviada','aguardando','convertido','perdido'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END $$;
  `);

  // Coluna uf para prospect (origem do formulário público)
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS uf VARCHAR(2)`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS palavras_chave TEXT[]`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS origem_formulario BOOLEAN NOT NULL DEFAULT FALSE`);


  // Acessos de portais por cliente
  await db.query(`
    CREATE TABLE IF NOT EXISTS acessos_portais (
      id           SERIAL PRIMARY KEY,
      cliente_id   INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      portal       VARCHAR(100) NOT NULL,
      login        VARCHAR(255),
      senha        VARCHAR(255),
      url          TEXT,
      observacoes  TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_acessos_cliente ON acessos_portais(cliente_id)`);

  // Campo indicado_por nos prospects
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS indicado_por VARCHAR(255)`);

  // Campo valor_minimo_lance nos pregoes
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS valor_minimo_lance NUMERIC`);
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS motivo_perda VARCHAR(100)`);
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS menor_preco_concorrente NUMERIC`);
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS monitorar_resultado BOOLEAN NOT NULL DEFAULT FALSE`);

  // Checklist de onboarding nos documentos
  await db.query(`ALTER TABLE documentos ADD COLUMN IF NOT EXISTS onboarding BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE documentos ADD COLUMN IF NOT EXISTS status_entrega VARCHAR(20) NOT NULL DEFAULT 'pendente'`);


  // Campos para timbrado e proposta readequada
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cnpj VARCHAR(18)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS razao_social VARCHAR(255)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS responsavel_legal VARCHAR(255)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cargo_responsavel VARCHAR(100)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cpf_responsavel VARCHAR(14)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS endereco TEXT`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS logo_base64 TEXT`);

  // Tabelas para módulo de documentação
  await db.query(`
    CREATE TABLE IF NOT EXISTS documentos_cliente (
      id               SERIAL PRIMARY KEY,
      cliente_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      token_upload     VARCHAR(64) UNIQUE,
      tipo             VARCHAR(100) NOT NULL,
      nome_arquivo     VARCHAR(255),
      caminho_arquivo  TEXT,
      data_vencimento  DATE,
      status           VARCHAR(50) NOT NULL DEFAULT 'pendente',
      observacoes      TEXT,
      enviado_em       TIMESTAMP,
      created_at       TIMESTAMP DEFAULT NOW(),
      updated_at       TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`CREATE TABLE IF NOT EXISTS tokens_upload (
    id         SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    token      VARCHAR(64) UNIQUE NOT NULL,
    usado      BOOLEAN DEFAULT FALSE,
    expira_em  TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS idx_docs_cliente_id ON documentos_cliente(cliente_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_docs_status ON documentos_cliente(status)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_docs_vencimento ON documentos_cliente(data_vencimento)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens_upload(token)');

  // Tabela para recursos licitatórios
  await db.query(`
    CREATE TABLE IF NOT EXISTS recursos_licitatorios (
      id            SERIAL PRIMARY KEY,
      pregao_id     INTEGER REFERENCES pregoes(id) ON DELETE CASCADE,
      cliente_id    INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      tipo          VARCHAR(50) NOT NULL DEFAULT 'recurso',
      motivo        TEXT,
      conteudo_html TEXT,
      status        VARCHAR(30) NOT NULL DEFAULT 'rascunho',
      criado_por    INTEGER REFERENCES usuarios(id),
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);


  // Colunas de alerta 48h e 24h nos pregões
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS alerta_48h_enviado BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE pregoes ADD COLUMN IF NOT EXISTS alerta_24h_enviado BOOLEAN NOT NULL DEFAULT FALSE`);

  // Coluna whatsapp nos usuários (para alertas diretos aos sócios)
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(20)`);

  // ── Módulo de Prospecção ampliado ────────────────────────────────────────────
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS edital TEXT`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS obs TEXT`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS origem VARCHAR(50) NOT NULL DEFAULT 'manual'`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS brevo_email_id VARCHAR(100)`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS brevo_status VARCHAR(30)`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS brevo_status_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS formulario_preenchido BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS analise_edson_id INTEGER REFERENCES analises_edson(id) ON DELETE SET NULL`);

  await db.query(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_status_check;
      EXCEPTION WHEN others THEN NULL;
      END;
      BEGIN
        ALTER TABLE prospects ADD CONSTRAINT prospects_status_check
          CHECK (status IN ('novo_lead','em_negociacao','proposta_enviada','aguardando',
                            'resumo_enviado','em_followup','convertido','perdido'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END $$;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS prospects_eventos (
      id          SERIAL PRIMARY KEY,
      prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      tipo        VARCHAR(50) NOT NULL,
      descricao   TEXT,
      dados       JSONB,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_prospects_eventos ON prospects_eventos(prospect_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status)`);

  // Planilha de pesquisa de preços — seleção de itens e resultado da pesquisa
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS itens_planilha_selecao  JSONB DEFAULT '[]'`);
  await db.query(`ALTER TABLE analises_edson ADD COLUMN IF NOT EXISTS itens_planilha_pesquisa JSONB DEFAULT '[]'`);

  // ── Gestão de pessoas ──────────────────────────────────────────────────────
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cargo        VARCHAR(100)`);
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS area         VARCHAR(100)`);
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS gestor_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL`);
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS clientes_ids INTEGER[] DEFAULT '{}'`);
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone     VARCHAR(20)`);
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bio          TEXT`);
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo        BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS data_entrada DATE DEFAULT CURRENT_DATE`);

  await db.query(`ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check`);
  await db.query(`
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_role_check
    CHECK (role IN ('socio_fundador','assistente','assistente_junior','diretor_comercial','operador','sdr','social_media','cliente','admin'))
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS usuario_permissoes (
      id           SERIAL PRIMARY KEY,
      usuario_id   INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      modulo       VARCHAR(50) NOT NULL,
      liberado     BOOLEAN DEFAULT TRUE,
      alterado_por INTEGER REFERENCES usuarios(id),
      alterado_em  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(usuario_id, modulo)
    )
  `);

  // email_templates e email_logs para disparo via Brevo
  await db.query(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id                    SERIAL PRIMARY KEY,
      slug                  VARCHAR(100) UNIQUE NOT NULL,
      nome                  VARCHAR(255) NOT NULL,
      assunto               VARCHAR(500) NOT NULL,
      corpo_html            TEXT NOT NULL,
      variaveis_disponiveis TEXT[],
      ativo                 BOOLEAN DEFAULT TRUE,
      criado_em             TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS email_logs (
      id                  SERIAL PRIMARY KEY,
      prospect_id         INTEGER REFERENCES prospects(id) ON DELETE SET NULL,
      template_slug       VARCHAR(100),
      destinatario_email  VARCHAR(255),
      status              VARCHAR(50) DEFAULT 'enviado',
      brevo_message_id    VARCHAR(255),
      erro_mensagem       TEXT,
      enviado_por         INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      enviado_em          TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Seeds dos 3 templates de prospecção
  await db.query(`
    INSERT INTO email_templates (slug, nome, assunto, corpo_html, variaveis_disponiveis)
    VALUES (
      'prospecto_desclassificado',
      'Prospecção — Desclassificado',
      '{{nome}}, encontramos uma forma de evitar desclassificações futuras',
      $TMPL$Olá {{nome}},

Vi que a {{empresa}} participou do Pregão {{numero_pregao}} da {{orgao}} e acabou sendo desclassificada.

Esse tipo de situação é mais comum do que parece — e quase sempre tem solução.

A Conlicit desenvolveu uma ferramenta que analisa o edital automaticamente, gera o checklist de documentos exatos que aquele pregão exige e avisa com antecedência quando alguma certidão está prestes a vencer.

Posso te mostrar como isso funciona em 20 minutos, com um edital do seu segmento? Sem compromisso.

É só responder este e-mail ou acessar nossa ferramenta gratuita:
{{link_ferramenta}}

Abraços,
{{remetente_nome}}
Conlicit — Seu copiloto em licitações$TMPL$,
      ARRAY['nome','empresa','numero_pregao','orgao','link_ferramenta','remetente_nome']
    )
    ON CONFLICT (slug) DO NOTHING
  `);

  await db.query(`
    INSERT INTO email_templates (slug, nome, assunto, corpo_html, variaveis_disponiveis)
    VALUES (
      'prospecto_segundo_lugar',
      'Prospecção — 2º Lugar',
      '{{nome}}, {{diferenca}} separou vocês do contrato',
      $TMPL$Olá {{nome}},

A {{empresa}} ficou em 2º lugar no Pregão {{numero_pregao}} da {{orgao}}.

Às vezes é uma questão de centavos. Às vezes é o preço que podia ter sido calibrado melhor. De qualquer forma, essa é uma oportunidade para a próxima licitação.

A Conlicit tem uma ferramenta que analisa o edital, simula a faixa de preço competitiva e mostra quais documentos preparar — tudo antes da sessão pública.

Quer ver como funciona? São 20 minutos e você sai com a análise de um edital real do seu segmento.

{{link_ferramenta}}

Abraços,
{{remetente_nome}}
Conlicit — Seu copiloto em licitações$TMPL$,
      ARRAY['nome','empresa','numero_pregao','orgao','diferenca','link_ferramenta','remetente_nome']
    )
    ON CONFLICT (slug) DO NOTHING
  `);

  await db.query(`
    INSERT INTO email_templates (slug, nome, assunto, corpo_html, variaveis_disponiveis)
    VALUES (
      'prospecto_primeiro_acesso',
      'Prospecção — Primeiro Acesso',
      '{{nome}}, sua empresa tem perfil para licitações públicas',
      $TMPL$Olá {{nome}},

Empresas do segmento de {{segmento}} têm vencido contratos públicos significativos em {{uf}} — e o mercado de compras governamentais movimentou R$ 1 trilhão em 2025.

A {{empresa}} tem o perfil certo para participar. O que geralmente falta é saber por onde começar: quais editais acompanhar, quais documentos separar e como formar o preço sem risco de desclassificação.

Criamos uma ferramenta gratuita que faz exatamente isso. Você cola o número do edital e em 2 minutos tem o checklist completo e a análise de viabilidade.

Experimente agora: {{link_ferramenta}}

Qualquer dúvida, estou à disposição.

Abraços,
{{remetente_nome}}
Conlicit — Seu copiloto em licitações$TMPL$,
      ARRAY['nome','empresa','segmento','uf','link_ferramenta','remetente_nome']
    )
    ON CONFLICT (slug) DO NOTHING
  `);

  // brevo_contact_id — ID do contato na lista Brevo (sync de prospecção)
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS brevo_contact_id VARCHAR(100)`);

  // ── Módulo Financeiro Interno ────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS financeiro_lancamentos (
      id           SERIAL PRIMARY KEY,
      tipo         VARCHAR(10) NOT NULL CHECK (tipo IN ('receita','despesa')),
      categoria    VARCHAR(100) NOT NULL,
      descricao    VARCHAR(255) NOT NULL,
      valor        NUMERIC(14,2) NOT NULL,
      data         DATE NOT NULL,
      recorrente   BOOLEAN DEFAULT FALSE,
      referencia   VARCHAR(50),
      created_at   TIMESTAMP DEFAULT NOW(),
      updated_at   TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_fin_tipo ON financeiro_lancamentos(tipo)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_fin_data ON financeiro_lancamentos(data)`);

  // Campo função específica do colaborador (distinto de cargo)
  await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS funcao TEXT`);

  // ── Fluxo SDR/Closer: novas colunas em prospects ─────────────────────────────
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS nome_empresa text`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS nicho text`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS responsavel_nome text`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS responsavel_cargo text`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS status_contato text DEFAULT 'novo_lead'`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS responsavel_id integer REFERENCES usuarios(id) ON DELETE SET NULL`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS anotacoes text`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS data_ultimo_contato timestamptz`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS campanhas_recebidas jsonb DEFAULT '[]'`);

  // ── Tabelas de marketing ──────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS campanhas_marketing (
      id            SERIAL PRIMARY KEY,
      nome          TEXT NOT NULL,
      tipo          TEXT NOT NULL DEFAULT 'email',
      assunto       TEXT,
      corpo         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'rascunho',
      criado_por    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      total_enviados INT DEFAULT 0,
      total_abertos  INT DEFAULT 0
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS campanha_leads (
      id              SERIAL PRIMARY KEY,
      campanha_id     INTEGER REFERENCES campanhas_marketing(id) ON DELETE CASCADE,
      prospect_id     INTEGER REFERENCES prospects(id) ON DELETE CASCADE,
      status_entrega  TEXT DEFAULT 'pendente',
      enviado_em      TIMESTAMPTZ,
      UNIQUE(campanha_id, prospect_id)
    )
  `);

  // ── Pagamentos flexíveis por cliente ─────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS cliente_pagamentos_config (
      id           SERIAL PRIMARY KEY,
      cliente_id   INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      descricao    TEXT,
      tipo_recorrencia TEXT NOT NULL,
      valor        NUMERIC(12,2) NOT NULL,
      dia_mes      INTEGER,
      numero_dia_util INTEGER,
      dia_semana   INTEGER,
      datas_customizadas JSONB,
      ativo        BOOLEAN DEFAULT TRUE,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cliente_pagamentos_lancamentos (
      id              SERIAL PRIMARY KEY,
      cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      config_id       INTEGER REFERENCES cliente_pagamentos_config(id) ON DELETE SET NULL,
      valor           NUMERIC(12,2) NOT NULL,
      data_vencimento DATE NOT NULL,
      data_pagamento  DATE,
      status          TEXT NOT NULL DEFAULT 'pendente',
      observacao      TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_pag_lanc_cliente    ON cliente_pagamentos_lancamentos(cliente_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_pag_lanc_vencimento ON cliente_pagamentos_lancamentos(data_vencimento)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_pag_lanc_status     ON cliente_pagamentos_lancamentos(status)`);

  // ── Documentos de cliente — campos de controle de vencimento e upload ────────
  await db.query(`ALTER TABLE documentos ADD COLUMN IF NOT EXISTS data_emissao DATE`);
  await db.query(`ALTER TABLE documentos ADD COLUMN IF NOT EXISTS alerta_vencimento_dias INTEGER DEFAULT 30`);
  await db.query(`ALTER TABLE documentos ADD COLUMN IF NOT EXISTS url_arquivo TEXT`);

  // ── Clientes: campos de configuração de pagamento simplificado ───────────────
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS forma_pagamento TEXT DEFAULT 'mensal'`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dia_semana      INTEGER`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS datas_pagamento JSONB DEFAULT '[]'`);

  // ── Acessos: campos adicionais para portais de licitação ─────────────────────
  await db.query(`ALTER TABLE acessos_portais ADD COLUMN IF NOT EXISTS portal_id       TEXT`);
  await db.query(`ALTER TABLE acessos_portais ADD COLUMN IF NOT EXISTS cpf_responsavel TEXT`);
  await db.query(`ALTER TABLE acessos_portais ADD COLUMN IF NOT EXISTS cnpj            TEXT`);
  await db.query(`ALTER TABLE acessos_portais ADD COLUMN IF NOT EXISTS tem_2fa         BOOLEAN DEFAULT FALSE`);
  await db.query(`ALTER TABLE acessos_portais ADD COLUMN IF NOT EXISTS obs_2fa         TEXT`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_acessos_portais_portal_id ON acessos_portais(cliente_id, portal_id) WHERE portal_id IS NOT NULL`);

  // ── Configurações do sistema (chave/valor) ────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS system_configs (
      key        VARCHAR(100) PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Template isca: Análise Gratuita de Edital ─────────────────────────────────
  await db.query(`
    INSERT INTO email_templates (slug, nome, assunto, corpo_html, variaveis_disponiveis)
    VALUES (
      'isca_analise_gratuita',
      'Isca — Análise Gratuita de Edital',
      '{{empresa}}, temos uma oportunidade para você',
      $TMPL$Olá, {{nome}}!

Somos da Conlicit, consultoria especializada em licitações públicas.

Identificamos que a {{empresa}} tem perfil para participar de contratos públicos no segmento de {{segmento}}.

Como presente, queremos te oferecer uma análise gratuita de edital — sem compromisso.

É só responder esse e-mail com interesse que enviamos uma análise completa de uma licitação compatível com o seu negócio.

Atenciosamente,
{{remetente_nome}}
Conlicit — Seu trabalho começa muito antes do edital.$TMPL$,
      ARRAY['nome','empresa','segmento','remetente_nome']
    )
    ON CONFLICT (slug) DO NOTHING
  `);

  // ── Onboarding de cliente ────────────────────────────────────────────────────
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cidade               VARCHAR(100)`);
  await db.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS onboarding_concluido BOOLEAN NOT NULL DEFAULT FALSE`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS onboarding_tokens (
      id          SERIAL PRIMARY KEY,
      token       VARCHAR(64) UNIQUE NOT NULL,
      cliente_id  INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      usado       BOOLEAN NOT NULL DEFAULT FALSE,
      expira_em   TIMESTAMPTZ NOT NULL,
      criado_em   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS credenciais_portais (
      id          SERIAL PRIMARY KEY,
      cliente_id  INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      portal      VARCHAR(100) NOT NULL,
      login_enc   TEXT NOT NULL,
      senha_enc   TEXT NOT NULL,
      criado_em   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(cliente_id, portal)
    )
  `);

  // Expandir constraint de status dos prospects para incluir todos os valores usados no kanban
  await db.query(`
    DO $$
    BEGIN
      ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_status_check;
    EXCEPTION WHEN others THEN NULL;
    END $$;
  `);
  await db.query(`
    DO $$ BEGIN
      ALTER TABLE prospects ADD CONSTRAINT prospects_status_check
        CHECK (status IN (
          'novo_lead','em_negociacao','proposta_enviada','aguardando',
          'resumo_enviado','em_followup','convertido','perdido',
          'contato_feito','respondido','fechado','sem_interesse'
        ));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // boletins — histórico de boletins manuais disparados
  await db.query(`
    CREATE TABLE IF NOT EXISTS boletins (
      id           SERIAL PRIMARY KEY,
      cliente_id   INTEGER,
      cliente_nome VARCHAR(255),
      semana       VARCHAR(20),
      editais_json JSONB,
      html_url     TEXT,
      disparado_em TIMESTAMP,
      canal        VARCHAR(20),
      criado_em    TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS boletins_items (
      id            SERIAL PRIMARY KEY,
      boletim_id    INTEGER REFERENCES boletins(id) ON DELETE CASCADE,
      titulo        TEXT,
      orgao         VARCHAR(255),
      uf            CHAR(2),
      valor         VARCHAR(50),
      prazo         VARCHAR(30),
      score         INTEGER,
      justificativa TEXT,
      recomendacao  VARCHAR(20)
    )
  `);

  // marketing_conteudos — calendário editorial
  await db.query(`
    CREATE TABLE IF NOT EXISTS marketing_conteudos (
      id              SERIAL PRIMARY KEY,
      canal           VARCHAR(30) NOT NULL,
      data_publicacao DATE NOT NULL,
      tipo_conteudo   VARCHAR(50),
      titulo          VARCHAR(200),
      texto_midia     TEXT,
      legenda         TEXT,
      hashtags        TEXT,
      status          VARCHAR(20) NOT NULL DEFAULT 'rascunho',
      url_midia       TEXT,
      nome_arquivo    VARCHAR(255),
      criado_por      INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em       TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mkt_cont_canal  ON marketing_conteudos(canal)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mkt_cont_data   ON marketing_conteudos(data_publicacao)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_mkt_cont_status ON marketing_conteudos(status)`);

  // boletins — colunas complementares (idempotente)
  await db.query(`ALTER TABLE boletins ADD COLUMN IF NOT EXISTS total_editais  INTEGER`);
  await db.query(`ALTER TABLE boletins ADD COLUMN IF NOT EXISTS html_gerado_em TIMESTAMPTZ`);
  await db.query(`ALTER TABLE boletins ADD COLUMN IF NOT EXISTS criado_por     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL`);

  // boletins_items — colunas complementares (idempotente)
  await db.query(`ALTER TABLE boletins_items ADD COLUMN IF NOT EXISTS fila_id  INTEGER`);
  await db.query(`ALTER TABLE boletins_items ADD COLUMN IF NOT EXISTS pncp_id  VARCHAR(200)`);

  // boletim_fila — fila de editais aguardando inclusão em boletins
  await db.query(`
    CREATE TABLE IF NOT EXISTS boletim_fila (
      id             SERIAL PRIMARY KEY,
      pncp_id        VARCHAR(200),
      titulo         TEXT,
      orgao          VARCHAR(255),
      uf             CHAR(2),
      valor          VARCHAR(50),
      prazo          DATE,
      modalidade     VARCHAR(100),
      objeto         TEXT,
      link_pncp      TEXT,
      cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
      score          INTEGER,
      justificativa  TEXT,
      recomendacao   VARCHAR(20),
      status         VARCHAR(30) NOT NULL DEFAULT 'na_fila',
      boletim_id     INTEGER REFERENCES boletins(id) ON DELETE SET NULL,
      adicionado_em  TIMESTAMPTZ DEFAULT NOW(),
      adicionado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      CONSTRAINT boletim_fila_status_check
        CHECK (status IN ('na_fila','incluido_boletim','descartado'))
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_boletim_fila_cliente ON boletim_fila(cliente_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_boletim_fila_status  ON boletim_fila(status)`);

  // boletins_interesses — interesses manifestados via botão no HTML do boletim
  await db.query(`
    CREATE TABLE IF NOT EXISTS boletins_interesses (
      id              SERIAL PRIMARY KEY,
      boletim_id      INTEGER REFERENCES boletins(id) ON DELETE SET NULL,
      boletim_item_id INTEGER REFERENCES boletins_items(id) ON DELETE SET NULL,
      cliente_id      INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
      titulo          TEXT,
      orgao           VARCHAR(255),
      uf              CHAR(2),
      valor           VARCHAR(50),
      prazo           VARCHAR(50),
      status          VARCHAR(30) NOT NULL DEFAULT 'interesse_confirmado',
      observacao      TEXT,
      convertido_em   TIMESTAMPTZ,
      pregao_id       INTEGER REFERENCES pregoes(id) ON DELETE SET NULL,
      registrado_em   TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT boletins_interesses_status_check
        CHECK (status IN ('interesse_confirmado','em_analise','convertido','sem_interesse'))
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_boletins_int_cliente ON boletins_interesses(cliente_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_boletins_int_status  ON boletins_interesses(status)`);

  // ── Multicanal: colunas prospects ────────────────────────────────────────────
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS canal_origem   VARCHAR(50)  DEFAULT 'manual'`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS utm_source     VARCHAR(100)`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS utm_medium     VARCHAR(100)`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS utm_campaign   VARCHAR(100)`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS utm_content    VARCHAR(100)`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS perfil_url     TEXT`);
  await db.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS empresa_url    TEXT`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_prospects_canal ON prospects(canal_origem)`);

  // google_prospects — empresas encontradas via busca
  await db.query(`
    CREATE TABLE IF NOT EXISTS google_prospects (
      id           SERIAL PRIMARY KEY,
      nome_empresa VARCHAR(255),
      site         TEXT,
      telefone     VARCHAR(50),
      email        VARCHAR(255),
      endereco     TEXT,
      nicho        VARCHAR(100),
      cidade       VARCHAR(100),
      query_usada  TEXT,
      relevancia   INTEGER DEFAULT 0,
      snippet      TEXT,
      status       VARCHAR(50) NOT NULL DEFAULT 'encontrado',
      prospect_id  INTEGER REFERENCES prospects(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT google_prospects_status_check
        CHECK (status IN ('encontrado','contatado','prospect_criado','descartado'))
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_google_prospects_nicho  ON google_prospects(nicho)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_google_prospects_status ON google_prospects(status)`);

  // social_templates — biblioteca de posts para LinkedIn/Instagram/Facebook
  await db.query(`
    CREATE TABLE IF NOT EXISTS social_templates (
      id          SERIAL PRIMARY KEY,
      canal       VARCHAR(50)  NOT NULL,
      tipo        VARCHAR(50)  NOT NULL,
      nicho       VARCHAR(100) NOT NULL DEFAULT 'geral',
      titulo      VARCHAR(255),
      conteudo    TEXT,
      hashtags    TEXT,
      cta_texto   VARCHAR(255),
      cta_link    TEXT,
      imagem_desc TEXT,
      status      VARCHAR(30)  NOT NULL DEFAULT 'rascunho',
      publicado_em DATE,
      resultado   TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_st_canal ON social_templates(canal)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_st_nicho ON social_templates(nicho)`);

  // Seed de templates sociais (apenas se tabela estiver vazia)
  const { rows: stCount } = await db.query(`SELECT COUNT(*)::int AS n FROM social_templates`);
  if (stCount[0].n === 0) {
    const { seedSocialTemplates } = require('../seeds/social_templates');
    await seedSocialTemplates(db);
  }

  // Planilha de proposta — extração de itens de edital via IA
  await db.query(`
    CREATE TABLE IF NOT EXISTS proposta_planilhas (
      id            SERIAL PRIMARY KEY,
      cliente_id    INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
      pregao_id     INTEGER REFERENCES pregoes(id) ON DELETE SET NULL,
      titulo        VARCHAR(300),
      arquivo_origem VARCHAR(500),
      paginas_itens VARCHAR(100),
      status        VARCHAR(50) DEFAULT 'ativo',
      criado_em     TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS proposta_itens (
      id                  SERIAL PRIMARY KEY,
      planilha_id         INTEGER REFERENCES proposta_planilhas(id) ON DELETE CASCADE,
      numero_item         INTEGER,
      descricao           TEXT NOT NULL,
      unidade             VARCHAR(50),
      quantidade          DECIMAL(12,4),
      valor_estimado      DECIMAL(12,2),
      valor_minimo        DECIMAL(12,2),
      marca_modelo        VARCHAR(300),
      ml_produto_id       VARCHAR(100),
      ml_preco_encontrado DECIMAL(12,2),
      ml_link             VARCHAR(500),
      criado_em           TIMESTAMPTZ DEFAULT NOW(),
      atualizado_em       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_proposta_itens_planilha ON proposta_itens(planilha_id)`);

  // ── Módulo Minha Área ─────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS oportunidades (
      id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      cliente_id        INTEGER     REFERENCES clientes(id) ON DELETE CASCADE,
      numero_edital     TEXT        NOT NULL,
      orgao             TEXT,
      objeto            TEXT,
      valor_estimado    NUMERIC(15,2),
      data_encerramento DATE,
      plataforma        TEXT,
      itens_match       TEXT[],
      url_edital        TEXT,
      status            TEXT        DEFAULT 'aguardando_resposta'
                          CHECK (status IN (
                            'aguardando_resposta','interesse','sem_interesse',
                            'expirado','alerta_urgente_enviado'
                          )),
      data_envio        TIMESTAMPTZ DEFAULT now(),
      data_resposta     TIMESTAMPTZ,
      criado_em         TIMESTAMPTZ DEFAULT now(),
      UNIQUE(cliente_id, numero_edital)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_oportunidades_hub_cliente ON oportunidades(cliente_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_oportunidades_hub_status  ON oportunidades(status)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tarefas_internas (
      id                        UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
      oportunidade_id           UUID    REFERENCES oportunidades(id) ON DELETE CASCADE,
      cliente_id                INTEGER REFERENCES clientes(id),
      tipo                      TEXT    CHECK (tipo IN (
        'gerar_planilha','analise_edital','adicionar_calendario',
        'criar_post','agendar_publicacao','organizar_documentos'
      )),
      atribuido_para_role       TEXT,
      atribuido_para_usuario_id INTEGER REFERENCES usuarios(id),
      status                    TEXT    DEFAULT 'pendente' CHECK (status IN (
        'pendente','em_andamento','concluido'
      )),
      url_resultado             TEXT,
      criado_em                 TIMESTAMPTZ DEFAULT now(),
      concluido_em              TIMESTAMPTZ
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tarefas_role    ON tarefas_internas(atribuido_para_role, status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tarefas_usuario ON tarefas_internas(atribuido_para_usuario_id, status)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS notificacoes (
      id              UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
      usuario_id      INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      role_destino    TEXT,
      oportunidade_id UUID    REFERENCES oportunidades(id) ON DELETE SET NULL,
      tipo            TEXT    CHECK (tipo IN (
        'interesse_confirmado','tarefa_pendente','alerta_prazo',
        'follow_up_pendente','post_pendente','alerta_urgente'
      )),
      titulo          TEXT NOT NULL,
      mensagem        TEXT NOT NULL,
      lida            BOOLEAN DEFAULT false,
      criado_em       TIMESTAMPTZ DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id, lida)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_notificacoes_role    ON notificacoes(role_destino, lida)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS calendario_conlicit (
      id                        UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
      tipo                      TEXT    DEFAULT 'pregao' CHECK (tipo IN (
        'pregao','editorial','reuniao','prazo_interno'
      )),
      oportunidade_id           UUID    REFERENCES oportunidades(id) ON DELETE SET NULL,
      cliente_id                INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
      titulo                    TEXT    NOT NULL,
      descricao                 TEXT,
      data_evento               DATE    NOT NULL,
      data_encerramento         DATE,
      plataforma                TEXT,
      orgao                     TEXT,
      valor_estimado            NUMERIC(15,2),
      visivel_para_roles        TEXT[]  DEFAULT ARRAY['admin','socio_fundador'],
      lembrete_3dias_enviado    BOOLEAN DEFAULT false,
      criado_em                 TIMESTAMPTZ DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_cal_conlicit_evento ON calendario_conlicit(data_evento)`);
  await db.query(`ALTER TABLE calendario_conlicit ADD COLUMN IF NOT EXISTS visivel_para_roles     TEXT[] DEFAULT ARRAY['admin','socio_fundador']`);
  await db.query(`ALTER TABLE calendario_conlicit ADD COLUMN IF NOT EXISTS lembrete_3dias_enviado BOOLEAN DEFAULT false`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS posts_editoriais (
      id               UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
      titulo           TEXT  NOT NULL,
      legenda          TEXT,
      plataforma       TEXT  CHECK (plataforma IN ('instagram','linkedin','facebook','stories')),
      status           TEXT  DEFAULT 'rascunho' CHECK (status IN (
        'rascunho','agendado','publicado','cancelado'
      )),
      data_publicacao  TIMESTAMPTZ,
      hashtags         TEXT[],
      formato          TEXT,
      brief_design     TEXT,
      criado_em        TIMESTAMPTZ DEFAULT now()
    )
  `);

  await db.query(`ALTER TABLE tarefas_internas ADD COLUMN IF NOT EXISTS titulo     TEXT`);
  await db.query(`ALTER TABLE tarefas_internas ADD COLUMN IF NOT EXISTS descricao  TEXT`);
  await db.query(`ALTER TABLE tarefas_internas ADD COLUMN IF NOT EXISTS prazo      DATE`);
  await db.query(`ALTER TABLE tarefas_internas ADD COLUMN IF NOT EXISTS prioridade TEXT DEFAULT 'normal'`);
  await db.query(`ALTER TABLE tarefas_internas ADD COLUMN IF NOT EXISTS criado_por INTEGER REFERENCES usuarios(id)`);

  // Contratações Diretas — pipeline de emails Make.com
  await db.query(`
    CREATE TABLE IF NOT EXISTS contratacoes_diretas (
      id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      data_recebimento DATE DEFAULT CURRENT_DATE,
      email_conta      VARCHAR(255),
      email_assunto    TEXT,
      objeto           TEXT,
      orgao            VARCHAR(500),
      valor_estimado   NUMERIC(15,2),
      prazo_resposta   DATE,
      score_geral      NUMERIC(4,1),
      status           VARCHAR(50) DEFAULT 'novo',
      email_corpo_raw  TEXT,
      link_original    TEXT,
      pdf_url          TEXT
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS contratacoes_matches (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      contratacao_id  UUID REFERENCES contratacoes_diretas(id) ON DELETE CASCADE,
      empresa_id      INTEGER,
      empresa_nome    VARCHAR(255),
      score_fit       NUMERIC(5,1),
      motivo          TEXT,
      notificado_em   TIMESTAMPTZ,
      notificado_via  VARCHAR(50)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS cnpj_cnae_cache (
      cnpj         VARCHAR(14) PRIMARY KEY,
      cnaes        JSONB,
      razao_social VARCHAR(500),
      atualizado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_contratacoes_data      ON contratacoes_diretas(created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_contratacoes_status    ON contratacoes_diretas(status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_matches_contratacao_id ON contratacoes_matches(contratacao_id)`);

  console.log('Migrações executadas com sucesso');
}

module.exports = { executarMigracoes };
