'use strict';
const db    = require('../database/db');
const axios = require('axios');

async function brevoStatus(req, res) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return res.json({ conectado: false, motivo: 'BREVO_API_KEY não configurada no servidor' });
  try {
    const { data } = await axios.get('https://api.brevo.com/v3/account', {
      headers: { 'api-key': apiKey },
      timeout: 6000,
    });
    // Buscar remetente salvo no banco
    const { rows } = await db.query(`SELECT key, value FROM system_configs WHERE key IN ('brevo_remetente_email','brevo_remetente_nome')`);
    const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return res.json({
      conectado: true,
      email: data.email,
      plano: data.plan?.[0]?.type || 'free',
      remetente_email: cfg.brevo_remetente_email || process.env.BREVO_REMETENTE_EMAIL || '',
      remetente_nome:  cfg.brevo_remetente_nome  || process.env.BREVO_REMETENTE_NOME  || 'Conlicit',
    });
  } catch (e) {
    return res.json({ conectado: false, motivo: e.response?.data?.message || e.message });
  }
}

async function getConfig(req, res) {
  try {
    const { rows } = await db.query(`SELECT key, value FROM system_configs WHERE key IN ('brevo_remetente_email','brevo_remetente_nome')`);
    const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return res.json({
      remetente_email: cfg.brevo_remetente_email || process.env.BREVO_REMETENTE_EMAIL || '',
      remetente_nome:  cfg.brevo_remetente_nome  || process.env.BREVO_REMETENTE_NOME  || 'Conlicit',
    });
  } catch (e) { return res.status(500).json({ erro: e.message }); }
}

async function saveConfig(req, res) {
  const { remetente_email, remetente_nome } = req.body ?? {};
  try {
    if (remetente_email !== undefined) {
      await db.query(`INSERT INTO system_configs (key, value, updated_at) VALUES ('brevo_remetente_email',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`, [remetente_email]);
    }
    if (remetente_nome !== undefined) {
      await db.query(`INSERT INTO system_configs (key, value, updated_at) VALUES ('brevo_remetente_nome',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`, [remetente_nome]);
    }
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ erro: e.message }); }
}

async function listarCampanhas(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT c.*, u.nome AS criador_nome
       FROM campanhas_marketing c
       LEFT JOIN usuarios u ON u.id = c.criado_por
       ORDER BY c.created_at DESC`,
    );
    return res.json({ dados: rows, total: rows.length });
  } catch (e) {
    console.error('[Marketing] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function criarCampanha(req, res) {
  const { nome, tipo, assunto, corpo } = req.body ?? {};
  if (!nome?.trim() || !corpo?.trim()) return res.status(400).json({ erro: 'nome e corpo são obrigatórios' });
  try {
    const { rows: [c] } = await db.query(
      `INSERT INTO campanhas_marketing (nome, tipo, assunto, corpo, criado_por, status)
       VALUES ($1, $2, $3, $4, $5, 'rascunho') RETURNING *`,
      [nome.trim(), tipo || 'email', assunto?.trim() || null, corpo.trim(), req.usuario.id],
    );
    return res.status(201).json(c);
  } catch (e) {
    console.error('[Marketing] criar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function editarCampanha(req, res) {
  const { id } = req.params;
  const { nome, tipo, assunto, corpo, status } = req.body ?? {};
  try {
    const { rows: [c] } = await db.query(
      `UPDATE campanhas_marketing SET
         nome    = COALESCE($1, nome),
         tipo    = COALESCE($2, tipo),
         assunto = COALESCE($3, assunto),
         corpo   = COALESCE($4, corpo),
         status  = COALESCE($5, status)
       WHERE id = $6 RETURNING *`,
      [nome?.trim()||null, tipo||null, assunto?.trim()||null, corpo?.trim()||null, status||null, id],
    );
    if (!c) return res.status(404).json({ erro: 'Campanha não encontrada' });
    return res.json(c);
  } catch (e) {
    console.error('[Marketing] editar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function excluirCampanha(req, res) {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query(`DELETE FROM campanhas_marketing WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ erro: 'Campanha não encontrada' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Marketing] excluir:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function dispararCampanha(req, res) {
  const { id } = req.params;
  const { prospect_ids, filtro } = req.body ?? {};

  try {
    const { rows: [camp] } = await db.query(
      `SELECT * FROM campanhas_marketing WHERE id = $1`, [id],
    );
    if (!camp) return res.status(404).json({ erro: 'Campanha não encontrada' });

    // Resolve lista de prospects
    let prospects = [];
    if (Array.isArray(prospect_ids) && prospect_ids.length > 0) {
      const { rows } = await db.query(
        `SELECT id, nome, nome_empresa, empresa, email, telefone, nicho, status_contato
         FROM prospects WHERE id = ANY($1::int[])`,
        [prospect_ids],
      );
      prospects = rows;
    } else if (filtro) {
      const conds = [];
      const vals  = [];
      if (filtro.status_contato) { vals.push(filtro.status_contato); conds.push(`status_contato = $${vals.length}`); }
      if (filtro.nicho) { vals.push(`%${filtro.nicho}%`); conds.push(`nicho ILIKE $${vals.length}`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await db.query(
        `SELECT id, nome, nome_empresa, empresa, email, telefone, nicho, status_contato
         FROM prospects ${where} LIMIT 500`,
        vals,
      );
      prospects = rows;
    }

    if (prospects.length === 0) return res.json({ enviados: 0, erros: [], aviso: 'Nenhum prospect encontrado' });

    let enviados = 0;
    const erros  = [];

    for (const p of prospects) {
      try {
        const nomeEmpresa = p.nome_empresa || p.empresa || p.nome || '';

        if (camp.tipo === 'email' && p.email) {
          const apiKey = process.env.BREVO_API_KEY;
          if (apiKey) {
            // Remetente: DB > env > fallback
            const { rows: cfgRows } = await db.query(`SELECT key,value FROM system_configs WHERE key IN ('brevo_remetente_email','brevo_remetente_nome')`).catch(() => ({ rows: [] }));
            const cfg = Object.fromEntries((cfgRows || []).map(r => [r.key, r.value]));
            const senderEmail = cfg.brevo_remetente_email || process.env.BREVO_REMETENTE_EMAIL || process.env.BREVO_FROM_EMAIL || 'noreply@conlicit.com';
            const senderName  = cfg.brevo_remetente_nome  || process.env.BREVO_REMETENTE_NOME  || 'Conlicit';
            await axios.post('https://api.brevo.com/v3/smtp/email', {
              sender:      { name: senderName, email: senderEmail },
              to:          [{ email: p.email, name: nomeEmpresa }],
              subject:     (camp.assunto || camp.nome)
                .replace(/\{\{empresa\}\}/gi, nomeEmpresa).replace(/\{\{nome\}\}/gi, p.nome || nomeEmpresa)
                .replace(/\{\{remetente_nome\}\}/gi, senderName),
              htmlContent: (() => {
                const corpo = camp.corpo
                  .replace(/\{\{empresa\}\}/gi, nomeEmpresa)
                  .replace(/\{\{nome\}\}/gi, p.nome || nomeEmpresa)
                  .replace(/\{\{nicho\}\}/gi, p.nicho || '')
                  .replace(/\{\{segmento\}\}/gi, p.nicho || '')
                  .replace(/\{\{remetente_nome\}\}/gi, senderName);
                return corpo.includes('<') ? corpo : `<p>${corpo.replace(/\n/g, '<br>')}</p>`;
              })(),
            }, {
              headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
              timeout: 10000,
            });
          }
        } else if (camp.tipo === 'whatsapp' && p.telefone) {
          // Integração Z-API se configurada
          if (process.env.ZAPI_INSTANCE && process.env.ZAPI_TOKEN) {
            const tel = p.telefone.replace(/\D/g, '');
            const texto = camp.corpo.replace(/\{\{empresa\}\}/gi, nomeEmpresa).replace(/\{\{nome\}\}/gi, p.nome || nomeEmpresa);
            await axios.post(
              `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
              { phone: `55${tel}`, message: texto },
              { timeout: 8000 },
            );
          }
        }

        // Registra em campanha_leads
        await db.query(
          `INSERT INTO campanha_leads (campanha_id, prospect_id, status_entrega, enviado_em)
           VALUES ($1, $2, 'enviado', NOW())
           ON CONFLICT (campanha_id, prospect_id) DO UPDATE SET status_entrega='enviado', enviado_em=NOW()`,
          [id, p.id],
        );

        // Atualiza campanhas_recebidas no prospect
        await db.query(
          `UPDATE prospects SET
             campanhas_recebidas = COALESCE(campanhas_recebidas,'[]'::jsonb) || $1::jsonb,
             data_ultimo_contato = NOW(),
             updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify([{ campanha_id: parseInt(id), nome: camp.nome, enviado_em: new Date().toISOString() }]), p.id],
        );

        enviados++;
      } catch (e) {
        erros.push({ prospect_id: p.id, nome: p.nome_empresa || p.nome, erro: e.message });
      }
    }

    // Atualiza contador na campanha
    await db.query(
      `UPDATE campanhas_marketing SET total_enviados = total_enviados + $1, status = 'enviada' WHERE id = $2`,
      [enviados, id],
    );

    return res.json({ enviados, erros, total_prospects: prospects.length });
  } catch (e) {
    console.error('[Marketing] disparar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

async function leadsParaCampanha(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT cl.*, p.nome, p.nome_empresa, p.empresa, p.email, p.nicho, p.status_contato
       FROM campanha_leads cl
       JOIN prospects p ON p.id = cl.prospect_id
       WHERE cl.campanha_id = $1
       ORDER BY cl.enviado_em DESC`,
      [id],
    );
    return res.json({ dados: rows, total: rows.length });
  } catch (e) {
    console.error('[Marketing] leadsParaCampanha:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listarCampanhas, criarCampanha, editarCampanha, excluirCampanha, dispararCampanha, leadsParaCampanha, brevoStatus, getConfig, saveConfig };
