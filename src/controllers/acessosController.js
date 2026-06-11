const db = require('../database/db');
const { criptografar, descriptografar } = require('../lib/cripto');

function descriptografarAcesso(row) {
  if (!row) return row;
  return { ...row, senha: descriptografar(row.senha) };
}

async function listar(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM acessos_portais WHERE cliente_id = $1 ORDER BY portal ASC`,
      [id],
    );
    return res.json({ dados: rows.map(descriptografarAcesso) });
  } catch (e) {
    console.error('[Acessos] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

function criptografarSenha(senha) {
  if (!senha) return null;
  try {
    return criptografar(senha);
  } catch (e) {
    if (e.message?.includes('ENCRYPTION_KEY')) {
      console.warn('[Acessos] ENCRYPTION_KEY não configurada — senha não será salva');
      return null;
    }
    throw e;
  }
}

async function criar(req, res) {
  const { id } = req.params;
  const { portal, portal_id, login, senha, url, observacoes,
          cpf_responsavel, cnpj, tem_2fa, obs_2fa } = req.body ?? {};
  if (!portal?.trim() && !portal_id?.trim()) return res.status(400).json({ erro: 'portal é obrigatório' });
  try {
    let a;
    if (portal_id) {
      // Upsert por portal_id (portais fixos)
      ({ rows: [a] } = await db.query(
        `INSERT INTO acessos_portais
           (cliente_id, portal_id, portal, login, cpf_responsavel, cnpj, senha, tem_2fa, obs_2fa, url, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (cliente_id, portal_id) DO UPDATE SET
           portal          = EXCLUDED.portal,
           login           = EXCLUDED.login,
           cpf_responsavel = EXCLUDED.cpf_responsavel,
           cnpj            = EXCLUDED.cnpj,
           senha           = EXCLUDED.senha,
           tem_2fa         = EXCLUDED.tem_2fa,
           obs_2fa         = EXCLUDED.obs_2fa,
           url             = EXCLUDED.url,
           observacoes     = EXCLUDED.observacoes
         RETURNING *`,
        [id, portal_id, portal?.trim() || portal_id,
         login?.trim() || null,
         cpf_responsavel?.trim() || null, cnpj?.trim() || null,
         criptografarSenha(senha?.trim() || null),
         tem_2fa || false, obs_2fa?.trim() || null,
         url?.trim() || null, observacoes?.trim() || null],
      ));
    } else {
      ({ rows: [a] } = await db.query(
        `INSERT INTO acessos_portais (cliente_id, portal, login, senha, url, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, portal.trim(), login?.trim() || null,
         criptografarSenha(senha?.trim() || null),
         url?.trim() || null, observacoes?.trim() || null],
      ));
    }
    return res.status(201).json(descriptografarAcesso(a));
  } catch (e) {
    console.error('[Acessos] criar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizar(req, res) {
  const { id, aid } = req.params;
  const { portal, login, senha, url, observacoes } = req.body ?? {};
  try {
    const { rows: [a] } = await db.query(
      `UPDATE acessos_portais SET portal=$1, login=$2, senha=$3, url=$4, observacoes=$5
       WHERE id=$6 AND cliente_id=$7 RETURNING *`,
      [portal?.trim(), login?.trim() || null,
       criptografarSenha(senha?.trim() || null),
       url?.trim() || null, observacoes?.trim() || null, aid, id],
    );
    if (!a) return res.status(404).json({ erro: 'Acesso não encontrado' });
    return res.json(descriptografarAcesso(a));
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

async function remover(req, res) {
  const { id, aid } = req.params;
  try {
    const { rowCount } = await db.query(
      `DELETE FROM acessos_portais WHERE id=$1 AND cliente_id=$2`, [aid, id],
    );
    if (!rowCount) return res.status(404).json({ erro: 'Acesso não encontrado' });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

module.exports = { listar, criar, atualizar, remover };
