const db = require('../database/db');

async function listar(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM documentos WHERE cliente_id = $1 ORDER BY onboarding DESC, created_at DESC`,
      [id],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (erro) {
    console.error('Erro ao listar documentos:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criar(req, res) {
  const { id } = req.params;
  const { nome, tipo, url, data_vencimento, onboarding, status_entrega } = req.body ?? {};

  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });

  try {
    const { rows } = await db.query(
      `INSERT INTO documentos (cliente_id, nome, tipo, url, data_vencimento, onboarding, status_entrega)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, nome.trim(), tipo || 'outro', url || null, data_vencimento || null,
       Boolean(onboarding), status_entrega || 'pendente'],
    );
    return res.status(201).json(rows[0]);
  } catch (erro) {
    console.error('Erro ao criar documento:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function remover(req, res) {
  const { id, did } = req.params;
  try {
    const { rowCount } = await db.query(
      `DELETE FROM documentos WHERE id = $1 AND cliente_id = $2`,
      [did, id],
    );
    if (rowCount === 0) return res.status(404).json({ erro: 'Documento não encontrado' });
    return res.json({ mensagem: 'Documento removido' });
  } catch (erro) {
    console.error('Erro ao remover documento:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}


const CHECKLIST_ONBOARDING = [
  { nome: 'Contrato Social / Estatuto', tipo: 'contrato_social' },
  { nome: 'Cartão CNPJ', tipo: 'cnpj' },
  { nome: 'Certidão Negativa Federal (RFB)', tipo: 'certidao' },
  { nome: 'Certidão Negativa Estadual', tipo: 'certidao' },
  { nome: 'Certidão Negativa Municipal', tipo: 'certidao' },
  { nome: 'Certidão FGTS', tipo: 'certidao' },
  { nome: 'Certidão Trabalhista (CNDT)', tipo: 'certidao' },
  { nome: 'Balanço Patrimonial', tipo: 'balanco' },
  { nome: 'Procuração para representação', tipo: 'procuracao' },
  { nome: 'Acesso GOV.BR (login + senha)', tipo: 'outro' },
];

async function inicializarOnboarding(req, res) {
  const { id } = req.params;
  try {
    const { rows: existentes } = await db.query(
      `SELECT nome FROM documentos WHERE cliente_id = $1 AND onboarding = TRUE`, [id],
    );
    const nomes = existentes.map(r => r.nome);
    const inserir = CHECKLIST_ONBOARDING.filter(d => !nomes.includes(d.nome));
    for (const doc of inserir) {
      await db.query(
        `INSERT INTO documentos (cliente_id, nome, tipo, onboarding, status_entrega)
         VALUES ($1,$2,$3,TRUE,'pendente')`,
        [id, doc.nome, doc.tipo],
      );
    }
    const { rows } = await db.query(
      `SELECT * FROM documentos WHERE cliente_id = $1 ORDER BY onboarding DESC, created_at DESC`, [id],
    );
    return res.json({ dados: rows, inicializados: inserir.length });
  } catch (e) {
    console.error('[Docs] inicializarOnboarding:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizarStatus(req, res) {
  const { id, did } = req.params;
  const { status_entrega } = req.body ?? {};
  const validos = ['pendente', 'recebido', 'vencido'];
  if (!validos.includes(status_entrega)) return res.status(400).json({ erro: 'status_entrega inválido' });
  try {
    const { rows: [d] } = await db.query(
      `UPDATE documentos SET status_entrega=$1 WHERE id=$2 AND cliente_id=$3 RETURNING *`,
      [status_entrega, did, id],
    );
    if (!d) return res.status(404).json({ erro: 'Documento não encontrado' });
    return res.json(d);
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

module.exports = { listar, criar, remover, inicializarOnboarding, atualizarStatus };
