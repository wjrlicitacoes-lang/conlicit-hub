const db = require('../database/db');

async function getMinhaArea(usuarioId) {
  const { rows: [usuario] } = await db.query(
    'SELECT id, nome, role FROM usuarios WHERE id = $1',
    [usuarioId],
  );
  if (!usuario) throw new Error('Usuário não encontrado');
  const { role } = usuario;

  if (role === 'admin' || role === 'socio_fundador') {
    return getDiretora(usuarioId, role);
  }
  if (role === 'assistente' || role === 'assistente_junior') {
    return getAssistente(usuarioId);
  }
  if (role === 'diretor_comercial') {
    return getComercial(role);
  }
  if (role === 'social_media') {
    return getRedesSociais(role);
  }
  return { mensagem: 'Perfil não configurado para Minha Área' };
}

async function getDiretora(usuarioId) {
  const [notifR, tarefasR, alertasR, resumoR] = await Promise.all([
    db.query(
      `SELECT * FROM notificacoes
       WHERE (usuario_id = $1 OR role_destino = 'admin') AND lida = false
       ORDER BY criado_em DESC LIMIT 10`,
      [usuarioId],
    ),
    db.query(
      `SELECT t.*, c.nome AS cliente_nome FROM tarefas_internas t
       LEFT JOIN clientes c ON c.id = t.cliente_id
       WHERE t.atribuido_para_role = 'admin' AND t.status = 'pendente'
       ORDER BY t.criado_em DESC`,
    ),
    db.query(
      `SELECT cc.*, c.nome AS cliente_nome FROM calendario_conlicit cc
       LEFT JOIN clientes c ON c.id = cc.cliente_id
       WHERE cc.data_encerramento BETWEEN now() AND now() + INTERVAL '5 days'
         AND 'admin' = ANY(cc.visivel_para_roles)
       ORDER BY cc.data_encerramento ASC`,
    ),
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'aguardando_resposta') AS total_aguardando,
         COUNT(*) FILTER (WHERE status = 'interesse')           AS total_interesse,
         COUNT(*) FILTER (WHERE status NOT IN ('expirado','sem_interesse')) AS total_ativas
       FROM oportunidades`,
    ),
  ]);

  const { rows: tarefasPend } = await db.query(
    `SELECT COUNT(*) AS total FROM tarefas_internas WHERE status = 'pendente'`,
  );

  return {
    notificacoes:     notifR.rows,
    tarefas_pendentes: tarefasR.rows,
    alertas_prazo:    alertasR.rows,
    resumo: {
      total_oportunidades_ativas:  Number(resumoR.rows[0]?.total_ativas      || 0),
      total_interesse_confirmado:  Number(resumoR.rows[0]?.total_interesse   || 0),
      total_aguardando_resposta:   Number(resumoR.rows[0]?.total_aguardando  || 0),
      total_tarefas_pendentes:     Number(tarefasPend.rows[0]?.total         || 0),
    },
  };
}

async function getDiretorGeral() {
  const [calR, resumoR, alertasR] = await Promise.all([
    db.query(
      `SELECT cc.*, c.nome AS cliente_nome FROM calendario_conlicit cc
       LEFT JOIN clientes c ON c.id = cc.cliente_id
       WHERE 'socio_fundador' = ANY(cc.visivel_para_roles)
         AND cc.data_encerramento >= now()
         AND cc.data_encerramento <= now() + INTERVAL '30 days'
       ORDER BY cc.data_encerramento ASC`,
    ),
    db.query(
      `SELECT c.nome AS cliente_nome, o.status, COUNT(*) AS total
       FROM oportunidades o
       JOIN clientes c ON c.id = o.cliente_id
       GROUP BY c.nome, o.status
       ORDER BY c.nome, o.status`,
    ),
    db.query(
      `SELECT cc.*, c.nome AS cliente_nome FROM calendario_conlicit cc
       LEFT JOIN clientes c ON c.id = cc.cliente_id
       WHERE cc.data_encerramento BETWEEN now() AND now() + INTERVAL '5 days'
         AND 'socio_fundador' = ANY(cc.visivel_para_roles)
       ORDER BY cc.data_encerramento ASC`,
    ),
  ]);

  return {
    calendario:        calR.rows,
    resumo_por_cliente: resumoR.rows,
    alertas_prazo:     alertasR.rows,
  };
}

async function getAssistente(usuarioId) {
  const [tarefasR, pregoesR] = await Promise.all([
    db.query(
      `SELECT t.*, c.nome AS cliente_nome FROM tarefas_internas t
       LEFT JOIN clientes c ON c.id = t.cliente_id
       WHERE (t.atribuido_para_usuario_id = $1
              OR (t.atribuido_para_role = 'assistente' AND t.atribuido_para_usuario_id IS NULL))
         AND t.status IN ('pendente','em_andamento')
       ORDER BY t.criado_em ASC`,
      [usuarioId],
    ),
    db.query(
      `SELECT o.*, c.nome AS cliente_nome FROM oportunidades o
       JOIN clientes c ON c.id = o.cliente_id
       WHERE o.status = 'interesse'
         AND EXISTS (
           SELECT 1 FROM tarefas_internas t
           WHERE t.oportunidade_id = o.id
             AND (t.atribuido_para_usuario_id = $1 OR t.atribuido_para_role = 'assistente')
         )`,
      [usuarioId],
    ),
  ]);

  return {
    tarefas_pendentes: tarefasR.rows,
    meus_pregoes:      pregoesR.rows,
  };
}

async function getComercial(role) {
  const [opR, followupR, notifR] = await Promise.all([
    db.query(
      `SELECT o.*, c.nome AS cliente_nome,
              EXTRACT(EPOCH FROM (now() - o.data_envio)) / 86400 AS dias_desde_envio
       FROM oportunidades o
       JOIN clientes c ON c.id = o.cliente_id
       WHERE o.status IN ('aguardando_resposta','interesse','sem_interesse')
       ORDER BY o.data_envio DESC`,
    ),
    db.query(
      `SELECT o.*, c.nome AS cliente_nome FROM oportunidades o
       JOIN clientes c ON c.id = o.cliente_id
       WHERE o.status = 'aguardando_resposta'
         AND o.data_envio < now() - INTERVAL '48 hours'`,
    ),
    db.query(
      `SELECT * FROM notificacoes
       WHERE role_destino = $1 AND lida = false
       ORDER BY criado_em DESC`,
      [role],
    ),
  ]);

  const pipeline = { aguardando_resposta: [], interesse: [], sem_interesse: [] };
  for (const op of opR.rows) {
    if (pipeline[op.status]) pipeline[op.status].push(op);
  }

  return {
    pipeline,
    alertas_follow_up: followupR.rows,
    notificacoes:      notifR.rows,
  };
}

async function getRedesSociais(role) {
  const [postsR, calR, notifR] = await Promise.all([
    db.query(
      `SELECT * FROM posts_editoriais
       WHERE status IN ('rascunho','agendado')
       ORDER BY data_publicacao ASC NULLS LAST`,
    ),
    db.query(
      `SELECT * FROM posts_editoriais
       WHERE data_publicacao BETWEEN now() AND now() + INTERVAL '30 days'
       ORDER BY data_publicacao ASC`,
    ),
    db.query(
      `SELECT * FROM notificacoes
       WHERE role_destino = $1 AND lida = false
       ORDER BY criado_em DESC`,
      [role],
    ),
  ]);

  return {
    posts_pendentes:    postsR.rows,
    calendario_editorial: calR.rows,
    notificacoes:       notifR.rows,
  };
}

module.exports = { getMinhaArea };
