const db      = require('../database/db');
const zapiSvc = require('../services/zapiService');

// ── Listar fila (sócio/admin vê tudo; assistente vê só aguardando_disparo) ──
async function listar(req, res) {
  const { role } = req.usuario;
  const { status, cliente_id } = req.query;
  try {
    const where  = [];
    const params = [];
    let idx = 1;

    if (role === 'assistente') {
      where.push(`o.status = 'aguardando_disparo'`);
    } else if (status) {
      where.push(`o.status = $${idx++}`);
      params.push(status);
    }
    if (cliente_id) {
      where.push(`o.cliente_id = $${idx++}`);
      params.push(parseInt(cliente_id, 10));
    }

    const sql = `
      SELECT o.*,
             c.nome AS cliente_nome,
             c.contato_whatsapp,
             c.whatsapp_grupo,
             u.nome AS criado_por_nome
      FROM oportunidades_fila o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN usuarios u ON u.id = o.criado_por
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY o.created_at DESC
      LIMIT 100
    `;
    const { rows } = await db.query(sql, params);
    return res.json(rows);
  } catch (e) {
    console.error('[Oportunidades] listar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

// ── Criar oportunidade na fila (sócio/admin) ──
async function criar(req, res) {
  if (!['socio_fundador', 'admin'].includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });

  const {
    edital_ref, numero_controle_pncp, orgao, objeto,
    valor_estimado, data_abertura, link_pncp, link_edital,
    portal, municipio, uf, cliente_id,
  } = req.body;

  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id obrigatório' });

  try {
    const { rows: [op] } = await db.query(
      `INSERT INTO oportunidades_fila
         (edital_ref, numero_controle_pncp, orgao, objeto, valor_estimado,
          data_abertura, link_pncp, link_edital, portal, municipio, uf,
          cliente_id, criado_por, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'aguardando_analise')
       RETURNING *`,
      [edital_ref, numero_controle_pncp, orgao, objeto, valor_estimado,
       data_abertura || null, link_pncp, link_edital, portal, municipio, uf,
       cliente_id, req.usuario.id],
    );
    return res.status(201).json(op);
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

// ── Gerar resumo Edson para disparo ──
async function gerarResumo(req, res) {
  const { id } = req.params;
  try {
    const { rows: [op] } = await db.query(
      `SELECT o.*, c.nome AS cliente_nome, c.palavras_chave, c.uf AS cliente_uf
       FROM oportunidades_fila o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       WHERE o.id = $1`, [id],
    );
    if (!op) return res.status(404).json({ erro: 'Oportunidade não encontrada' });

    const prompt = `Você é o Edson, especialista em licitações da Conlicit.
Gere um resumo OBJETIVO desta licitação para enviar ao cliente via WhatsApp.
O resumo deve ser direto, sem jargão jurídico, com no máximo 250 palavras.

DADOS DA LICITAÇÃO:
Objeto: ${op.objeto || '—'}
Órgão: ${op.orgao || '—'}
Valor estimado: ${op.valor_estimado ? `R$ ${Number(op.valor_estimado).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : 'Sigiloso'}
Data da sessão: ${op.data_abertura ? new Date(op.data_abertura).toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'}) : '—'}
Plataforma: ${op.portal || '—'}
Cidade/UF: ${op.municipio ? `${op.municipio}/${op.uf}` : op.uf || '—'}
Cliente: ${op.cliente_nome || '—'}

Responda APENAS com este JSON:
{
  "resumo_whatsapp": "<texto formatado para WhatsApp com emojis, máx 250 palavras>",
  "valor_formatado": "<R$ X.XXX,XX ou Sigiloso>",
  "data_formatada": "<DD/MM/AAAA às HH:MM>",
  "plataforma": "<nome da plataforma>",
  "cidade_uf": "<Cidade/UF>",
  "documentos_principais": ["<doc 1>", "<doc 2>", "<doc 3>"],
  "forma_entrega": "<descrição resumida>",
  "score_rapido": <0-100>,
  "recomendacao": "<PARTICIPAR|AVALIAR|NÃO PARTICIPAR>"
}`;

    const { callClaude } = require('../services/edsonService');
    const raw = await callClaude(prompt, 2000);
    let resumo;
    try {
      const limpo = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      resumo = JSON.parse(limpo);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      resumo = m ? JSON.parse(m[0]) : { resumo_whatsapp: raw };
    }

    await db.query(
      `UPDATE oportunidades_fila SET resumo_edson=$1, resumo_gerado_em=NOW(), status='aguardando_disparo' WHERE id=$2`,
      [JSON.stringify(resumo), id],
    );

    return res.json({ ok: true, resumo });
  } catch (e) {
    console.error('[Oportunidades] gerarResumo:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

// ── Disparar para o cliente via WhatsApp ──
async function disparar(req, res) {
  const { id } = req.params;
  try {
    const { rows: [op] } = await db.query(
      `SELECT o.*, c.nome AS cliente_nome, c.contato_whatsapp, c.whatsapp_grupo,
              c.responsavel AS cliente_responsavel
       FROM oportunidades_fila o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       WHERE o.id = $1`, [id],
    );
    if (!op) return res.status(404).json({ erro: 'Oportunidade não encontrada' });
    if (!op.resumo_edson) return res.status(400).json({ erro: 'Gere o resumo antes de disparar' });

    const resumo = typeof op.resumo_edson === 'string'
      ? JSON.parse(op.resumo_edson)
      : op.resumo_edson;

    const msgGrupo =
      `🔔 *Nova Oportunidade — Conlicit*\n\n` +
      `${resumo.resumo_whatsapp || op.objeto}\n\n` +
      `📅 *Data:* ${resumo.data_formatada || '—'}\n` +
      `💰 *Valor:* ${resumo.valor_formatado || '—'}\n` +
      `🏛️ *Plataforma:* ${resumo.plataforma || op.portal || '—'}\n` +
      `📍 *Local:* ${resumo.cidade_uf || '—'}\n\n` +
      `📋 *Documentos principais:*\n` +
      (resumo.documentos_principais || []).map(d => `• ${d}`).join('\n') + '\n\n' +
      `📦 *Entrega:* ${resumo.forma_entrega || '—'}\n\n` +
      `⚡ *Recomendação Edson:* ${resumo.recomendacao || '—'}\n\n` +
      `_Responda diretamente nesta conversa: confirmar interesse ou não participar._`;

    const msgDM =
      `Olá! Identificamos uma oportunidade para *${op.cliente_nome}*.\n\n` +
      `*${op.objeto}*\n\n` +
      `💰 Valor: ${resumo.valor_formatado || '—'}\n` +
      `📅 Sessão: ${resumo.data_formatada || '—'}\n` +
      `🏛️ Plataforma: ${resumo.plataforma || '—'}\n\n` +
      `Você tem interesse em participar desta licitação?`;

    const erros = [];

    if (op.whatsapp_grupo) {
      try {
        await zapiSvc.enviarGrupo(op.whatsapp_grupo, msgGrupo);
      } catch (e) { erros.push(`Grupo: ${e.message}`); }
    }

    if (op.contato_whatsapp) {
      try {
        await zapiSvc.enviarBotoes(
          op.contato_whatsapp,
          '🔔 Nova Oportunidade',
          msgDM,
          'Conlicit Hub · hub.conlicit.com',
          [
            { id: `sim_${op.id}`, label: '✅ Vamos participar!' },
            { id: `nao_${op.id}`, label: '❌ Não tenho interesse' },
          ],
        );
      } catch {
        try {
          await zapiSvc.enviarTexto(
            op.contato_whatsapp,
            msgDM + '\n\nResponda *SIM* para participar ou *NÃO* para recusar.',
          );
        } catch (e2) { erros.push(`DM: ${e2.message}`); }
      }
    }

    await db.query(
      `UPDATE oportunidades_fila SET status='disparado', disparado_em=NOW() WHERE id=$1`, [id],
    );

    return res.json({ ok: true, erros: erros.length ? erros : undefined });
  } catch (e) {
    console.error('[Oportunidades] disparar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

// ── Registrar resposta do cliente (manual ou via webhook) ──
async function registrarResposta(req, res) {
  const { id } = req.params;
  const { resposta } = req.body;

  try {
    const { rows: [op] } = await db.query(
      `UPDATE oportunidades_fila
       SET status = $1, resposta_cliente = $2, resposta_em = NOW()
       WHERE id = $3
       RETURNING *, (SELECT nome FROM clientes WHERE id=cliente_id) AS cliente_nome`,
      [resposta === 'sim' ? 'interesse_confirmado' : 'sem_interesse', resposta, id],
    );
    if (!op) return res.status(404).json({ erro: 'Oportunidade não encontrada' });

    if (resposta === 'sim') {
      const { rows: [pregao] } = await db.query(
        `INSERT INTO pregoes (cliente_id, numero, orgao, objeto, valor_estimado,
                              data_hora_abertura, link_pncp, status, numero_controle_pncp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'a_disputar',$8)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [op.cliente_id, op.edital_ref, op.orgao, op.objeto, op.valor_estimado,
         op.data_abertura, op.link_pncp, op.numero_controle_pncp],
      );
      if (pregao) {
        await db.query(
          `UPDATE oportunidades_fila SET pregao_id=$1 WHERE id=$2`,
          [pregao.id, id],
        ).catch(() => {});
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[Oportunidades] registrarResposta:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

// ── Webhook Z-API — captura respostas automáticas ──
async function webhookZapi(req, res) {
  try {
    const body   = req.body;
    const texto  = (body?.text?.message || body?.message || '').toUpperCase().trim();
    const telefone = body?.phone || body?.from || '';

    const { rows } = await db.query(
      `SELECT o.id FROM oportunidades_fila o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       WHERE c.contato_whatsapp LIKE $1 AND o.status = 'disparado'
       ORDER BY o.disparado_em DESC LIMIT 1`,
      [`%${telefone.replace(/\D/g, '').slice(-9)}%`],
    );

    if (rows.length > 0) {
      const opId    = rows[0].id;
      const buttonId = body?.buttonsResponseMessage?.selectedButtonId || '';
      const simBtn  = buttonId.startsWith('sim_') || ['SIM','S','VAMOS','OK','CONFIRMO','✅'].some(p => texto.includes(p));
      const naoBtn  = buttonId.startsWith('nao_') || ['NÃO','NAO','N','RECUSO','❌'].some(p => texto.includes(p));

      const fakeRes = { json: () => {} };
      if (simBtn) {
        await registrarResposta({ params: { id: opId }, body: { resposta: 'sim' } }, fakeRes);
        await zapiSvc.enviarTexto(telefone,
          '✅ Ótimo! Registramos seu interesse. Nossa equipe vai entrar em contato para iniciar a preparação. 🚀');
      } else if (naoBtn) {
        await registrarResposta({ params: { id: opId }, body: { resposta: 'nao' } }, fakeRes);
        await zapiSvc.enviarTexto(telefone,
          '👍 Entendido! Registramos que não há interesse desta vez. Continuaremos monitorando oportunidades para você.');
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[Webhook Z-API]', e.message);
    return res.status(200).json({ ok: true });
  }
}

// ── TEMPORÁRIO — listar grupos Z-API para obter IDs ──
async function listarGrupos(req, res) {
  try {
    const r = await require('axios').get(
      `${process.env.ZAPI_BASE_URL || 'https://api.z-api.io'}/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/chats`,
      { timeout: 15000 },
    );
    const grupos = (r.data || []).filter(c => c.isGroup);
    return res.json(grupos.map(g => ({ id: g.id, nome: g.name })));
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

module.exports = { listar, criar, gerarResumo, disparar, registrarResposta, webhookZapi, listarGrupos };
