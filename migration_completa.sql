-- ============================================================
-- CONLICIT HUB — MIGRATION COMPLETA
-- Execute no Supabase SQL Editor em ordem
-- ============================================================

-- 0. Habilitar pgcrypto para geração de hash bcrypt
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. TABELA usuarios — ampliar roles aceitos
-- ============================================================
-- Remover constraint antiga de role (se existir) e adicionar nova
DO $$
BEGIN
  ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check;
EXCEPTION WHEN others THEN NULL;
END$$;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_role_check CHECK (role IN (
    'socio_fundador','admin','assistente','assistente_junior',
    'diretor_comercial','operador','sdr','social_media','cliente'
  ));

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS ativo    BOOLEAN DEFAULT true;

-- Inserir usuária Sabrine (senha: Conlicit@2026)
INSERT INTO usuarios (nome, email, senha_hash, whatsapp, role, ativo)
VALUES (
  'Sabrine Pessoa',
  'wjrlicitacoes@gmail.com',
  crypt('Conlicit@2026', gen_salt('bf', 12)),
  '5531982388210',
  'admin',
  true
)
ON CONFLICT (email) DO UPDATE
  SET role  = 'admin',
      ativo = true,
      whatsapp = '5531982388210';

-- Migrar roles antigos para os novos (idempotente)
UPDATE usuarios SET role = 'admin'             WHERE role = 'diretora_executiva';
UPDATE usuarios SET role = 'socio_fundador'    WHERE role = 'diretor_geral';
UPDATE usuarios SET role = 'diretor_comercial' WHERE role = 'comercial';
UPDATE usuarios SET role = 'social_media'      WHERE role = 'assistente_redes_sociais';

-- ============================================================
-- 2. TABELA municipios_ibge (municípios de MG)
-- ============================================================
CREATE TABLE IF NOT EXISTS municipios_ibge (
  id           SERIAL PRIMARY KEY,
  nome         TEXT NOT NULL,
  uf           CHAR(2) NOT NULL,
  codigo_ibge  TEXT,
  lat          NUMERIC(9,6),
  lng          NUMERIC(9,6)
);
CREATE INDEX IF NOT EXISTS idx_municipios_uf   ON municipios_ibge(uf);
CREATE INDEX IF NOT EXISTS idx_municipios_nome ON municipios_ibge(LOWER(nome));

INSERT INTO municipios_ibge (nome, uf, codigo_ibge, lat, lng) VALUES
('Abadia dos Dourados','MG','3100104',-18.4936,-47.3933),
('Abaeté','MG','3100203',-19.1553,-45.4436),
('Além Paraíba','MG','3101508',-21.8778,-42.6981),
('Alfenas','MG','3101706',-21.4289,-45.9489),
('Almenara','MG','3101805',-16.1844,-40.6925),
('Araguari','MG','3103504',-18.6484,-48.1864),
('Araxá','MG','3104007',-19.5925,-46.9411),
('Barbacena','MG','3105608',-21.2261,-43.7744),
('Belo Horizonte','MG','3106200',-19.9245,-43.9352),
('Betim','MG','3106705',-19.9681,-44.1983),
('Brumadinho','MG','3109006',-20.1425,-44.2017),
('Caratinga','MG','3113206',-19.7847,-42.1411),
('Cataguases','MG','3115003',-21.3897,-42.6953),
('Caxambu','MG','3115300',-21.9767,-44.9306),
('Conselheiro Lafaiete','MG','3118304',-20.6600,-43.7900),
('Contagem','MG','3118601',-19.9317,-44.0536),
('Coronel Fabriciano','MG','3119401',-19.5181,-42.6281),
('Curvelo','MG','3120904',-18.7558,-44.4333),
('Diamantina','MG','3121605',-18.2431,-43.6036),
('Divinópolis','MG','3122306',-20.1389,-44.8853),
('Espinosa','MG','3124302',-14.9275,-42.8189),
('Formiga','MG','3126109',-20.4631,-45.4261),
('Francisco Sá','MG','3126602',-16.4764,-43.4858),
('Frutal','MG','3127107',-20.0261,-48.9408),
('Governador Valadares','MG','3127701',-18.8514,-41.9494),
('Guanhães','MG','3128303',-18.7786,-42.9319),
('Ibirité','MG','3129806',-20.0244,-44.0581),
('Ipatinga','MG','3131307',-19.4681,-42.5375),
('Itabira','MG','3131703',-19.6189,-43.2264),
('Itabirito','MG','3131802',-20.2531,-43.8006),
('Itajubá','MG','3132404',-22.4286,-45.4528),
('Itaúna','MG','3133808',-20.0767,-44.5736),
('Ituiutaba','MG','3134202',-18.9719,-49.4636),
('Januária','MG','3135209',-15.4883,-44.3625),
('João Monlevade','MG','3136207',-19.8108,-43.1769),
('Juiz de Fora','MG','3136702',-21.7642,-43.3503),
('Lagoa Santa','MG','3137601',-19.6344,-43.8911),
('Lavras','MG','3138203',-21.2453,-44.9994),
('Leopoldina','MG','3138609',-21.5311,-42.6422),
('Manhuaçu','MG','3139805',-20.2575,-42.0317),
('Mariana','MG','3140001',-20.3783,-43.4161),
('Montes Claros','MG','3143302',-16.7286,-43.8614),
('Muriaé','MG','3143906',-21.1297,-42.3669),
('Nova Lima','MG','3144805',-19.9847,-43.8531),
('Nova Serrana','MG','3145208',-19.8744,-44.9942),
('Ouro Branco','MG','3145901',-20.5217,-43.6992),
('Ouro Preto','MG','3146107',-20.3856,-43.5036),
('Pará de Minas','MG','3147105',-19.8600,-44.6128),
('Passos','MG','3147501',-20.7197,-46.6103),
('Patos de Minas','MG','3148004',-18.5789,-46.5183),
('Patrocínio','MG','3148103',-18.9447,-46.9931),
('Peçanha','MG','3148707',-18.5444,-42.5581),
('Pedro Leopoldo','MG','3149309',-19.6200,-44.0436),
('Pirapora','MG','3150703',-17.3444,-44.9428),
('Pitangui','MG','3151206',-19.6767,-44.8914),
('Poços de Caldas','MG','3151800',-21.7872,-46.5611),
('Ponte Nova','MG','3152006',-20.4172,-42.9094),
('Pouso Alegre','MG','3152501',-22.2297,-45.9331),
('Ribeirão das Neves','MG','3154606',-19.7675,-44.0844),
('Rio Piracicaba','MG','3155603',-19.9367,-43.1744),
('Sabará','MG','3156700',-19.8867,-43.8156),
('Santa Luzia','MG','3157807',-19.7692,-43.8514),
('São Francisco','MG','3161106',-15.9483,-44.8614),
('São João del Rei','MG','3162500',-21.1344,-44.2644),
('São Lourenço','MG','3163109',-22.1153,-45.0644),
('São Sebastião do Paraíso','MG','3164605',-20.9167,-46.9906),
('Sete Lagoas','MG','3167202',-19.4711,-44.2472),
('Teófilo Otoni','MG','3168606',-17.8578,-41.5058),
('Timóteo','MG','3168903',-19.5822,-42.6431),
('Três Corações','MG','3169000',-21.6928,-45.2567),
('Ubá','MG','3169307',-21.1183,-42.9419),
('Uberaba','MG','3170107',-19.7489,-47.9308),
('Uberlândia','MG','3170206',-18.9186,-48.2772),
('Unaí','MG','3170404',-16.3617,-46.9039),
('Varginha','MG','3170701',-21.5517,-45.4308),
('Várzea da Palma','MG','3170800',-17.5944,-44.7289),
('Viçosa','MG','3171303',-20.7558,-42.8828)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. TABELA clientes — adicionar colunas
-- ============================================================
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS municipio_base TEXT,
  ADD COLUMN IF NOT EXISTS uf_base        CHAR(2)  DEFAULT 'MG',
  ADD COLUMN IF NOT EXISTS raio_km        INTEGER  DEFAULT 100,
  ADD COLUMN IF NOT EXISTS ativo          BOOLEAN  DEFAULT true;
-- whatsapp já existe na tabela clientes (verificar se está lá)
-- ALTER TABLE clientes ADD COLUMN IF NOT EXISTS whatsapp TEXT;

-- ============================================================
-- 4. TABELA oportunidades (nova — diferente de oportunidades_fila)
-- Usa INTEGER para FKs em clientes (SERIAL)
-- ============================================================
CREATE TABLE IF NOT EXISTS oportunidades (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id          INTEGER     REFERENCES clientes(id) ON DELETE CASCADE,
  numero_edital       TEXT        NOT NULL,
  orgao               TEXT,
  objeto              TEXT,
  valor_estimado      NUMERIC(15,2),
  data_encerramento   DATE,
  plataforma          TEXT,
  itens_match         TEXT[],
  url_edital          TEXT,
  status              TEXT        DEFAULT 'aguardando_resposta'
                        CHECK (status IN (
                          'aguardando_resposta','interesse','sem_interesse',
                          'expirado','alerta_urgente_enviado'
                        )),
  data_envio          TIMESTAMPTZ DEFAULT now(),
  data_resposta       TIMESTAMPTZ,
  criado_em           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cliente_id, numero_edital)
);
CREATE INDEX IF NOT EXISTS idx_oportunidades_hub_cliente ON oportunidades(cliente_id);
CREATE INDEX IF NOT EXISTS idx_oportunidades_hub_status  ON oportunidades(status);

-- ============================================================
-- 5. TABELA tarefas_internas
-- ============================================================
CREATE TABLE IF NOT EXISTS tarefas_internas (
  id                        UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  oportunidade_id           UUID    REFERENCES oportunidades(id) ON DELETE CASCADE,
  cliente_id                INTEGER REFERENCES clientes(id),
  tipo                      TEXT    CHECK (tipo IN (
    'gerar_planilha','analise_edital','adicionar_calendario',
    'criar_post','agendar_publicacao','organizar_documentos'
  )),
  atribuido_para_role       TEXT    CHECK (atribuido_para_role IN (
    'admin','socio_fundador','assistente','assistente_junior',
    'diretor_comercial','operador','sdr','social_media'
  )),
  atribuido_para_usuario_id INTEGER REFERENCES usuarios(id),
  status                    TEXT    DEFAULT 'pendente' CHECK (status IN (
    'pendente','em_andamento','concluido'
  )),
  url_resultado             TEXT,
  criado_em                 TIMESTAMPTZ DEFAULT now(),
  concluido_em              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tarefas_role    ON tarefas_internas(atribuido_para_role, status);
CREATE INDEX IF NOT EXISTS idx_tarefas_usuario ON tarefas_internas(atribuido_para_usuario_id, status);

-- ============================================================
-- 6. TABELA notificacoes
-- ============================================================
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
);
CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id, lida);
CREATE INDEX IF NOT EXISTS idx_notificacoes_role    ON notificacoes(role_destino, lida);

-- ============================================================
-- 7. TABELA calendario_conlicit
-- ============================================================
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
);
CREATE INDEX IF NOT EXISTS idx_cal_conlicit_evento ON calendario_conlicit(data_evento);

ALTER TABLE calendario_conlicit
  ADD COLUMN IF NOT EXISTS tipo                   TEXT DEFAULT 'pregao',
  ADD COLUMN IF NOT EXISTS oportunidade_id        UUID,
  ADD COLUMN IF NOT EXISTS visivel_para_roles     TEXT[] DEFAULT ARRAY['admin','socio_fundador'],
  ADD COLUMN IF NOT EXISTS lembrete_3dias_enviado BOOLEAN DEFAULT false;

-- ============================================================
-- 8. TABELA posts_editoriais
-- ============================================================
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
);

-- ============================================================
-- 9. TABELA contratos_gerados (Gerador de Contratos V2)
-- ============================================================
CREATE TABLE IF NOT EXISTS contratos_gerados (
  id                  SERIAL PRIMARY KEY,
  nome_cliente        VARCHAR(200),
  cnpj_cpf            VARCHAR(30),
  telefone            VARCHAR(30),
  endereco            TEXT,
  representante       VARCHAR(200),
  cargo               VARCHAR(100),
  email               VARCHAR(200),
  data_inicio         DATE,
  prazo_meses         INTEGER,
  plano               VARCHAR(50),
  modalidades         TEXT,
  segmentos           TEXT,
  abrangencia         VARCHAR(200),
  honorario_mensal    VARCHAR(50),
  dia_vencimento      INTEGER,
  comissao_exitop     VARCHAR(20),
  prazo_exito_dias    INTEGER,
  forma_pagamento     VARCHAR(100),
  multa_rescisoria    VARCHAR(20),
  observacoes         TEXT,
  servicos            JSONB DEFAULT '[]',
  criado_por          INTEGER REFERENCES usuarios(id),
  criado_em           TIMESTAMP DEFAULT NOW(),
  atualizado_em       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contratos_cliente ON contratos_gerados(nome_cliente);
CREATE INDEX IF NOT EXISTS idx_contratos_criador ON contratos_gerados(criado_por);

-- ============================================================
-- RESUMO DA MIGRATION
-- ============================================================
-- Sabrine: wjrlicitacoes@gmail.com / senha: Conlicit@2026
-- JWT_SECRET para Railway:
--   ac5918062e9b486eb5dc7476b94dee9e110a985cc00d9248980ee4088a36f548
-- Webhook Z-API URL:
--   POST https://web-production-18d79.up.railway.app/webhook/whatsapp
-- Troca de senha: POST /auth/trocar-senha
--   Body: { "senha_atual": "Conlicit@2026", "senha_nova": "<nova>" }
