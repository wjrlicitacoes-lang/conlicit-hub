const jwt = require('jsonwebtoken');
const db  = require('../database/db');

const TODOS_MODULOS = [
  // Chaves de proteção de rotas (backend — não alterar)
  'dashboard','clientes','editais','boletins','edson',
  'calendario','monitor','prospects','usuarios','financeiro',
  'gerador_proposta','relatorios',
  // Chaves de visibilidade do sidebar (frontend)
  'edson_ia','buscar_editais','oportunidades','robo_pregao',
  'minha_area','pregoes','proposta_comercial','documentacao','marketing',
];

const PERMISSOES_ROLE = {
  socio_fundador:    [...TODOS_MODULOS],
  admin:             [...TODOS_MODULOS],
  assistente:        [
    'dashboard','clientes','editais','boletins','calendario','edson','monitor',
    'buscar_editais','edson_ia','robo_pregao','oportunidades',
  ],
  assistente_junior: [
    'dashboard','clientes','editais','boletins','calendario',
    'buscar_editais','edson_ia',
  ],
  diretor_comercial: [
    'dashboard','editais','calendario','prospects','edson','gerador_proposta',
    'buscar_editais','edson_ia','proposta_comercial','oportunidades','prospects',
  ],
  operador:          [
    'dashboard','clientes','editais','boletins','edson','monitor','calendario',
    'buscar_editais','edson_ia','robo_pregao','oportunidades',
  ],
  sdr:               [
    'dashboard','editais','boletins','prospects','calendario',
    'buscar_editais','prospects',
  ],
  social_media:      ['dashboard','documentacao','marketing'],
  cliente:           ['minha_area','pregoes','edson','edson_ia'],
};

function verificarPermissao(modulo) {
  return async (req, res, next) => {
    const { id: userId, role } = req.usuario;
    if (['socio_fundador', 'admin'].includes(role)) return next();
    try {
      const { rows } = await db.query(
        'SELECT liberado FROM usuario_permissoes WHERE usuario_id=$1 AND modulo=$2',
        [userId, modulo],
      );
      if (rows.length > 0) {
        return rows[0].liberado
          ? next()
          : res.status(403).json({ erro: 'Acesso bloqueado pelo administrador' });
      }
      const permitido = (PERMISSOES_ROLE[role] || []).includes(modulo);
      return permitido ? next() : res.status(403).json({ erro: 'Sem permissão para este módulo' });
    } catch (e) {
      console.error('[verificarPermissao] Erro:', e.message);
      return res.status(500).json({ erro: 'Erro ao verificar permissões' });
    }
  };
}

async function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token de acesso não informado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);

    // Tokens emitidos antes de role ser adicionado ao payload não têm req.usuario.role.
    // Fallback: busca role (e id) no banco para garantir retrocompatibilidade.
    if ((!req.usuario.role || req.usuario.cliente_id === undefined) && req.usuario.email) {
      const { rows } = await db.query(
        'SELECT id, role, cliente_id FROM usuarios WHERE email = $1',
        [req.usuario.email],
      );
      if (rows[0]) {
        req.usuario.id         = req.usuario.id   ?? rows[0].id;
        req.usuario.role       = req.usuario.role ?? rows[0].role;
        req.usuario.cliente_id = req.usuario.cliente_id ?? rows[0].cliente_id ?? null;
      }
    }

    next();
  } catch (erro) {
    const mensagem = erro.name === 'TokenExpiredError'
      ? 'Token expirado. Faça login novamente'
      : 'Token inválido';

    return res.status(401).json({ erro: mensagem });
  }
}

module.exports = autenticar;
module.exports.verificarPermissao = verificarPermissao;
module.exports.PERMISSOES_ROLE    = PERMISSOES_ROLE;
module.exports.TODOS_MODULOS      = TODOS_MODULOS;
