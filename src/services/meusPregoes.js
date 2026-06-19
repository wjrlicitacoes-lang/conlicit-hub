const db = require('../database/db');

async function getMeusPregoes(usuarioId) {
  const { rows: [usuario] } = await db.query(
    'SELECT id, role FROM usuarios WHERE id = $1',
    [usuarioId],
  );
  if (!usuario) throw new Error('Usuário não encontrado');
  const { role } = usuario;

  if (['admin', 'socio_fundador'].includes(role)) {
    return getPregoesGestores();
  }
  if (['assistente', 'assistente_junior'].includes(role)) {
    return getPregoesAssistente(usuarioId);
  }
  if (role === 'diretor_comercial') {
    return getPregoesComercial();
  }
  if (role === 'social_media') {
    return { pregoes: [], mensagem: 'Seu acesso é ao módulo editorial.' };
  }
  return { pregoes: [] };
}

async function getPregoesGestores() {
  const { rows } = await db.query(
    `SELECT
       o.*,
       c.nome AS cliente_nome,
       json_agg(json_build_object(
         'id', t.id,
         'tipo', t.tipo,
         'status', t.status,
         'url_resultado', t.url_resultado
       )) FILTER (WHERE t.id IS NOT NULL) AS tarefas
     FROM oportunidades o
     JOIN clientes c ON c.id = o.cliente_id
     LEFT JOIN tarefas_internas t ON t.oportunidade_id = o.id
     WHERE o.status = 'interesse'
     GROUP BY o.id, c.nome
     ORDER BY o.data_encerramento ASC`,
  );
  return { pregoes: rows };
}

async function getPregoesAssistente(usuarioId) {
  const { rows } = await db.query(
    `SELECT
       o.*,
       c.nome AS cliente_nome,
       json_agg(json_build_object(
         'id', t.id,
         'tipo', t.tipo,
         'status', t.status,
         'url_resultado', t.url_resultado
       )) FILTER (WHERE t.id IS NOT NULL) AS tarefas
     FROM oportunidades o
     JOIN clientes c ON c.id = o.cliente_id
     JOIN tarefas_internas t ON t.oportunidade_id = o.id
     WHERE o.status = 'interesse'
       AND (t.atribuido_para_usuario_id = $1 OR t.atribuido_para_role = 'assistente')
     GROUP BY o.id, c.nome`,
  [usuarioId],
  );
  return { pregoes: rows };
}

async function getPregoesComercial() {
  const { rows } = await db.query(
    `SELECT
       o.*,
       c.nome AS cliente_nome,
       EXTRACT(EPOCH FROM (now() - o.data_envio)) / 86400 AS dias_desde_envio
     FROM oportunidades o
     JOIN clientes c ON c.id = o.cliente_id
     WHERE o.status IN ('aguardando_resposta','interesse','sem_interesse')
     ORDER BY o.data_envio DESC`,
  );
  return { pregoes: rows };
}

module.exports = { getMeusPregoes };
