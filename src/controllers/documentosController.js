const db = require('../database/db');
const { createClient } = require('@supabase/supabase-js');

function supabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function computarStatus(data_vencimento, alerta_dias) {
  if (!data_vencimento) return 'pendente';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = new Date(data_vencimento);
  const dias = Math.round((venc - hoje) / 86400000);
  if (dias < 0) return 'vencido';
  if (dias <= (alerta_dias ?? 30)) return 'vencendo';
  return 'valido';
}

async function listar(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM documentos WHERE cliente_id = $1 ORDER BY onboarding DESC, created_at DESC`,
      [id],
    );
    const dados = rows.map(d => ({
      ...d,
      status_documento: computarStatus(d.data_vencimento, d.alerta_vencimento_dias),
    }));
    return res.json({ total: dados.length, dados });
  } catch (erro) {
    console.error('Erro ao listar documentos:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criar(req, res) {
  const { id } = req.params;
  const { nome, tipo, url, data_vencimento, data_emissao, alerta_vencimento_dias, onboarding, status_entrega } = req.body ?? {};

  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });

  try {
    const { rows } = await db.query(
      `INSERT INTO documentos (cliente_id, nome, tipo, url, data_vencimento, data_emissao, alerta_vencimento_dias, onboarding, status_entrega)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, nome.trim(), tipo || 'outro', url || null, data_vencimento || null,
       data_emissao || null, alerta_vencimento_dias ?? 30,
       Boolean(onboarding), status_entrega || 'pendente'],
    );
    const d = rows[0];
    return res.status(201).json({ ...d, status_documento: computarStatus(d.data_vencimento, d.alerta_vencimento_dias) });
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

async function upload(req, res) {
  const { id, did } = req.params;
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

  const sb = supabase();
  if (!sb) return res.status(500).json({ erro: 'Supabase não configurado' });

  try {
    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const fileName = `clientes/${id}/doc_${did}_${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage
      .from('documentos-clientes')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (upErr) throw upErr;

    const { data: { publicUrl } } = sb.storage.from('documentos-clientes').getPublicUrl(fileName);

    const { rows: [d] } = await db.query(
      `UPDATE documentos SET url_arquivo = $1 WHERE id = $2 AND cliente_id = $3 RETURNING *`,
      [publicUrl, did, id],
    );
    if (!d) return res.status(404).json({ erro: 'Documento não encontrado' });
    return res.json({ ...d, status_documento: computarStatus(d.data_vencimento, d.alerta_vencimento_dias) });
  } catch (e) {
    console.error('[Docs] upload:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

async function atualizarMetadados(req, res) {
  const { id, did } = req.params;
  const { nome, tipo, url, data_vencimento, data_emissao, alerta_vencimento_dias } = req.body ?? {};
  try {
    const { rows: [d] } = await db.query(
      `UPDATE documentos SET
         nome = COALESCE($1, nome),
         tipo = COALESCE($2, tipo),
         url  = COALESCE($3, url),
         data_vencimento = COALESCE($4, data_vencimento),
         data_emissao = COALESCE($5, data_emissao),
         alerta_vencimento_dias = COALESCE($6, alerta_vencimento_dias)
       WHERE id = $7 AND cliente_id = $8 RETURNING *`,
      [nome || null, tipo || null, url || null, data_vencimento || null,
       data_emissao || null, alerta_vencimento_dias ?? null, did, id],
    );
    if (!d) return res.status(404).json({ erro: 'Documento não encontrado' });
    return res.json({ ...d, status_documento: computarStatus(d.data_vencimento, d.alerta_vencimento_dias) });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
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
    const dados = rows.map(d => ({ ...d, status_documento: computarStatus(d.data_vencimento, d.alerta_vencimento_dias) }));
    return res.json({ dados, inicializados: inserir.length });
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
    return res.json({ ...d, status_documento: computarStatus(d.data_vencimento, d.alerta_vencimento_dias) });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

module.exports = { listar, criar, remover, upload, atualizarMetadados, inicializarOnboarding, atualizarStatus };
