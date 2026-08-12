const db = require('../database/db');
const { gerarProposta } = require('../services/geradorPropostaService');

async function gerar(req, res) {
  const { pid } = req.params;
  const { itens } = req.body ?? {};
  try {
    const proposta = await gerarProposta({ pregaoId: pid, itensRequest: itens, usuarioId: req.usuario?.id });
    return res.status(201).json(proposta);
  } catch (e) {
    console.error('[PregaoPropostas] gerar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

async function listar(req, res) {
  const { pid } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM pregao_propostas WHERE pregao_id = $1 ORDER BY versao DESC`,
      [pid],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[PregaoPropostas] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { gerar, listar };
