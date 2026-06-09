const db           = require('../database/db');
const emailService = require('../services/emailService');

async function enviarEmailProspect(req, res) {
  const { id } = req.params;
  const { template_id, destinatario_email, destinatario_nome, variaveis = {} } = req.body ?? {};

  if (!template_id || !destinatario_email) {
    return res.status(400).json({ erro: 'template_id e destinatario_email são obrigatórios' });
  }

  try {
    const { rows: [prospect] } = await db.query(
      'SELECT id, nome, empresa, email, segmento, uf FROM prospects WHERE id = $1', [id],
    );
    if (!prospect) return res.status(404).json({ erro: 'Prospect não encontrado' });

    const { rows: [template] } = await db.query(
      'SELECT slug, assunto, corpo_html FROM email_templates WHERE slug = $1 AND ativo = TRUE',
      [template_id],
    );
    if (!template) return res.status(404).json({ erro: 'Template não encontrado ou inativo' });

    const varsFinais = {
      nome:      destinatario_nome || prospect.nome || destinatario_email,
      empresa:   prospect.empresa || '',
      segmento:  prospect.segmento || '',
      uf:        prospect.uf || '',
      ...variaveis,
    };

    let brevoId = null;
    let statusLog = 'enviado';
    let erroMsg = null;

    try {
      const resultado = await emailService.enviarEmail({
        destinatarioEmail: destinatario_email,
        destinatarioNome:  destinatario_nome || prospect.nome,
        assunto:           template.assunto,
        corpoHtml:         template.corpo_html,
        variaveis:         varsFinais,
      });
      brevoId = resultado?.messageId || resultado?.simulado ? 'simulado' : null;
    } catch (e) {
      statusLog = 'erro';
      erroMsg   = e.message;
      console.error('[emailProspect] Falha no envio:', e.message);
    }

    await db.query(
      `INSERT INTO email_logs
         (prospect_id, template_slug, destinatario_email, status, brevo_message_id, erro_mensagem, enviado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, template_id, destinatario_email, statusLog, brevoId, erroMsg, req.usuario?.id || null],
    );

    if (statusLog === 'erro') {
      return res.status(502).json({ erro: `Falha no envio: ${erroMsg}` });
    }

    return res.json({ ok: true, mensagem: 'E-mail enviado com sucesso' });
  } catch (e) {
    console.error('[emailProspect]', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function listarTemplates(req, res) {
  try {
    const { rows } = await db.query(
      'SELECT slug, nome, assunto, variaveis_disponiveis FROM email_templates WHERE ativo = TRUE ORDER BY id',
    );
    return res.json({ dados: rows });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function listarLogsProspect(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT el.*, u.nome AS enviado_por_nome
       FROM email_logs el
       LEFT JOIN usuarios u ON u.id = el.enviado_por
       WHERE el.prospect_id = $1
       ORDER BY el.enviado_em DESC`,
      [id],
    );
    return res.json({ dados: rows });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { enviarEmailProspect, listarTemplates, listarLogsProspect };
