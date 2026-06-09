const db = require('../database/db');

const ROLES_PROPOSTA = ['admin', 'socio_fundador', 'diretor_comercial'];

function temAcesso(role) {
  return ROLES_PROPOSTA.includes(role);
}

async function proximoNumero(req, res) {
  if (!temAcesso(req.usuario.role)) return res.status(403).json({ erro: 'Acesso negado' });
  try {
    const ano = new Date().getFullYear();
    const r = await db.query(
      `SELECT COUNT(*) FROM propostas WHERE numero LIKE $1`,
      [`%/${ano}`]
    );
    const seq = parseInt(r.rows[0].count, 10) + 1;
    const numero = `${String(seq).padStart(3, '0')} / ${ano}`;
    res.json({ numero });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao gerar número' });
  }
}

async function salvar(req, res) {
  if (!temAcesso(req.usuario.role)) return res.status(403).json({ erro: 'Acesso negado' });
  const { numero, cliente, responsavel, valor_mensalidade, percentual_comissao, dados_json } = req.body;
  if (!numero) return res.status(400).json({ erro: 'Número obrigatório' });
  try {
    const r = await db.query(
      `INSERT INTO propostas (numero, cliente, responsavel, valor_mensalidade, percentual_comissao, dados_json, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [numero, cliente, responsavel, valor_mensalidade, percentual_comissao, dados_json ? JSON.stringify(dados_json) : null, req.usuario.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao salvar proposta' });
  }
}

async function listar(req, res) {
  if (!temAcesso(req.usuario.role)) return res.status(403).json({ erro: 'Acesso negado' });
  try {
    let query, params;
    if (req.usuario.role === 'diretor_comercial') {
      query = `SELECT id, numero, cliente, responsavel, valor_mensalidade, created_at
               FROM propostas WHERE criado_por = $1 ORDER BY created_at DESC`;
      params = [req.usuario.id];
    } else {
      query = `SELECT p.id, p.numero, p.cliente, p.responsavel, p.valor_mensalidade, p.percentual_comissao, p.created_at, u.nome AS criado_por_nome
               FROM propostas p LEFT JOIN usuarios u ON u.id = p.criado_por
               ORDER BY p.created_at DESC`;
      params = [];
    }
    const r = await db.query(query, params);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar propostas' });
  }
}

async function buscar(req, res) {
  if (!temAcesso(req.usuario.role)) return res.status(403).json({ erro: 'Acesso negado' });
  try {
    const r = await db.query(`SELECT * FROM propostas WHERE id = $1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Proposta não encontrada' });
    const p = r.rows[0];
    if (req.usuario.role === 'diretor_comercial' && p.criado_por !== req.usuario.id) {
      return res.status(403).json({ erro: 'Acesso negado' });
    }
    res.json(p);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar proposta' });
  }
}

async function excluir(req, res) {
  if (!temAcesso(req.usuario.role)) return res.status(403).json({ erro: 'Acesso negado' });
  try {
    const { rows: [p] } = await db.query(`SELECT criado_por FROM propostas WHERE id = $1`, [req.params.id]);
    if (!p) return res.status(404).json({ erro: 'Proposta não encontrada' });
    if (req.usuario.role === 'diretor_comercial' && p.criado_por !== req.usuario.id) {
      return res.status(403).json({ erro: 'Acesso negado' });
    }
    await db.query(`DELETE FROM propostas WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: 'Erro ao excluir proposta' });
  }
}

module.exports = { proximoNumero, salvar, listar, buscar, excluir };
