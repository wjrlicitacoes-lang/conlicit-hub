const db = require('../database/db');

async function getMinhaArea(usuarioId) {
  const { rows: [usuario] } = await db.query(
    'SELECT id, nome, role FROM usuarios WHERE id = $1',
    [usuarioId],
  );
  if (!usuario) throw new Error('Usuário não encontrado');
  const { role } = usuario;

  if (role === 'socio_fundador') {
    return getDiretorGeral();
  }
  if (role === 'admin') {
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

// Helper: nunca lança erro — retorna [] se a query falhar
async function safeQuery(sql, params = []) {
  try {
    const { rows } = await db.query(sql, params);
    return rows;
  } catch (e) {
    console.warn('[MinhaArea] query falhou:', e.message, '| SQL trecho:', sql.slice(0, 80));
    return [];
  }
}

async function getDiretorGeral() {
  const [calendario, resumoPorCliente, alertasPrazo] = await Promise.all([
    safeQuery(
      `SELECT cc.*, c.nome AS cliente_nome FROM calendario_conlicit cc
       LEFT JOIN clientes c ON c.id = cc.cliente_id
       WHERE 'socio_fundador' = ANY(cc.visivel_para_roles)
         AND cc.data_encerramento >= CURRENT_DATE
         AND cc.data_encerramento <= CURRENT_DATE + INTERVAL '30 days'
       ORDER BY cc.data_encerramento ASC`,
    ),
    safeQuery(
      `SELECT c.nome AS cliente_nome, o.status, COUNT(*) AS total
       FROM oportunidades o
       JOIN clientes c ON c.id = o.cliente_id
       GROUP BY c.nome, o.status
       ORDER BY c.nome, o.status`,
    ),
    safeQuery(
      `SELECT cc.*, c.nome AS cliente_nome FROM calendario_conlicit cc
       LEFT JOIN clientes c ON c.id = cc.cliente_id
       WHERE cc.data_encerramento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '5 days'
         AND 'socio_fundador' = ANY(cc.visivel_para_roles)
       ORDER BY cc.data_encerramento ASC`,
    ),
  ]);

  return {
    calendario,
    resumo_por_cliente: resumoPorCliente,
    alertas_prazo:      alertasPrazo,
  };
}

async function getDiretora(usuarioId, role) {
  const [notificacoes, tarefasPendentes, alertasPrazo, resumoArr] = await Promise.all([
    safeQuery(
      `SELECT * FROM notificacoes
       WHERE (usuario_id = $1 OR role_destino = $2) AND lida = false
       ORDER BY criado_em DESC LIMIT 10`,
      [usuarioId, role],
    ),
    safeQuery(
      `SELECT t.*, c.nome AS cliente_nome FROM tarefas_internas t
       LEFT JOIN clientes c ON c.id = t.cliente_id
       WHERE t.atribuido_para_role = $1 AND t.status = 'pendente'
       ORDER BY t.criado_em DESC`,
      [role],
    ),
    safeQuery(
      `SELECT cc.*, c.nome AS cliente_nome FROM calendario_conlicit cc
       LEFT JOIN clientes c ON c.id = cc.cliente_id
       WHERE cc.data_encerramento BETWEEN now() AND now() + INTERVAL '5 days'
         AND $1 = ANY(cc.visivel_para_roles)
       ORDER BY cc.data_encerramento ASC`,
      [role],
    ),
    safeQuery(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'aguardando_resposta') AS total_aguardando,
         COUNT(*) FILTER (WHERE status = 'interesse')           AS total_interesse,
         COUNT(*) FILTER (WHERE status NOT IN ('expirado','sem_interesse')) AS total_ativas
       FROM oportunidades`,
    ),
  ]);

  const tarefasPend = await safeQuery(
    `SELECT COUNT(*) AS total FROM tarefas_internas WHERE status = 'pendente'`,
  );

  return {
    notificacoes,
    tarefas_pendentes: tarefasPendentes,
    alertas_prazo:     alertasPrazo,
    resumo: {
      total_oportunidades_ativas: Number(resumoArr[0]?.total_ativas     || 0),
      total_interesse_confirmado: Number(resumoArr[0]?.total_interesse  || 0),
      total_aguardando_resposta:  Number(resumoArr[0]?.total_aguardando || 0),
      total_tarefas_pendentes:    Number(tarefasPend[0]?.total          || 0),
    },
  };
}

async function getAssistente(usuarioId) {
  const [tarefasPendentes, meusPregoes] = await Promise.all([
    safeQuery(
      `SELECT t.*, c.nome AS cliente_nome FROM tarefas_internas t
       LEFT JOIN clientes c ON c.id = t.cliente_id
       WHERE (t.atribuido_para_usuario_id = $1
              OR (t.atribuido_para_role = 'assistente' AND t.atribuido_para_usuario_id IS NULL))
         AND t.status IN ('pendente','em_andamento')
       ORDER BY t.criado_em ASC`,
      [usuarioId],
    ),
    safeQuery(
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
    tarefas_pendentes: tarefasPendentes,
    meus_pregoes:      meusPregoes,
  };
}

async function getComercial(role) {
  const [opRows, followupRows, notifRows] = await Promise.all([
    safeQuery(
      `SELECT o.*, c.nome AS cliente_nome,
              EXTRACT(EPOCH FROM (now() - o.data_envio)) / 86400 AS dias_desde_envio
       FROM oportunidades o
       JOIN clientes c ON c.id = o.cliente_id
       WHERE o.status IN ('aguardando_resposta','interesse','sem_interesse')
       ORDER BY o.data_envio DESC`,
    ),
    safeQuery(
      `SELECT o.*, c.nome AS cliente_nome FROM oportunidades o
       JOIN clientes c ON c.id = o.cliente_id
       WHERE o.status = 'aguardando_resposta'
         AND o.data_envio < now() - INTERVAL '48 hours'`,
    ),
    safeQuery(
      `SELECT * FROM notificacoes
       WHERE role_destino = $1 AND lida = false
       ORDER BY criado_em DESC`,
      [role],
    ),
  ]);

  const pipeline = { aguardando_resposta: [], interesse: [], sem_interesse: [] };
  for (const op of opRows) {
    if (pipeline[op.status]) pipeline[op.status].push(op);
  }

  return {
    pipeline,
    alertas_follow_up: followupRows,
    notificacoes:      notifRows,
  };
}

async function getRedesSociais(role) {
  const [postsPendentes, calendarioEditorial, notificacoes] = await Promise.all([
    safeQuery(
      `SELECT * FROM posts_editoriais
       WHERE status IN ('rascunho','agendado')
       ORDER BY data_publicacao ASC NULLS LAST`,
    ),
    safeQuery(
      `SELECT * FROM posts_editoriais
       WHERE data_publicacao BETWEEN now() AND now() + INTERVAL '30 days'
       ORDER BY data_publicacao ASC`,
    ),
    safeQuery(
      `SELECT * FROM notificacoes
       WHERE role_destino = $1 AND lida = false
       ORDER BY criado_em DESC`,
      [role],
    ),
  ]);

  return {
    posts_pendentes:      postsPendentes,
    calendario_editorial: calendarioEditorial,
    notificacoes,
  };
}

module.exports = { getMinhaArea };
