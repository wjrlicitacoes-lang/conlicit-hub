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
             u.nome AS criado_por_nome,
             u2.nome AS operador_nome
      FROM oportunidades_fila o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN usuarios u ON u.id = o.criado_por
      LEFT JOIN usuarios u2 ON u2.id = o.operador_id
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

// ── Buscar oportunidade por ID ──
async function buscarPorId(req, res) {
  const { id } = req.params;
  try {
    const { rows: [op] } = await db.query(
      `SELECT o.*, c.nome AS cliente_nome, c.contato_whatsapp, c.whatsapp_grupo,
              u.nome AS criado_por_nome
       FROM oportunidades_fila o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN usuarios u ON u.id = o.criado_por
       WHERE o.id = $1`, [id],
    );
    if (!op) return res.status(404).json({ erro: 'Oportunidade não encontrada' });
    return res.json(op);
  } catch (e) {
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

    const dataFormatada = (() => {
      const dt = op.data_abertura;
      if (!dt) return '—';
      try {
        const d = new Date(dt);
        if (isNaN(d.getTime())) return '—';
        const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
        const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
        return `${data} às ${hora}`;
      } catch { return '—'; }
    })();

    const prompt = `Você é o Edson, especialista em licitações da Conlicit.
Gere um resumo desta licitação para disparar ao cliente via WhatsApp.

DADOS:
Objeto: ${op.objeto || '—'}
Órgão: ${op.orgao || '—'}
Valor estimado: ${op.valor_estimado ? `R$ ${Number(op.valor_estimado).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : 'Verificar no edital'}
Data fim de recebimento de propostas (dataEncerramentoProposta): ${dataFormatada}
Plataforma: ${op.portal || '—'}
Cidade/UF: ${op.municipio ? `${op.municipio}/${op.uf}` : '—'}
Cliente: ${op.cliente_nome || '—'}
Link PNCP: ${op.link_pncp || op.link_edital || '—'}

Responda APENAS com este JSON (sem markdown):
{
  "resumo_whatsapp": "<máximo 2 linhas descrevendo o objeto e a oportunidade — NÃO repita data, valor, plataforma nem localização, pois esses campos já aparecem separados na mensagem>",
  "valor_formatado": "<R$ X.XXX,XX — NUNCA use 'sigiloso' se houver valor nos dados acima>",
  "data_formatada": "${dataFormatada}",
  "plataforma": "<nome da plataforma>",
  "cidade_uf": "<Cidade/UF>",
  "tipo_julgamento": "<Por Item|Por Lote|Global — inferir pelo objeto>",
  "tipo_entrega": "<Integral|Parcelada|Imediata — inferir pelo objeto>",
  "documentos_principais": <array com APENAS documentos reais mencionados no edital (certidões, atestados, contratos sociais, etc.). Se não houver texto do edital ou documentos explícitos nos dados acima, retorne []. NÃO invente documentos genéricos.>,
  "forma_entrega": "<descrição resumida do local e prazo de entrega>",
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

    if (resumo.valor_formatado && resumo.valor_formatado.toLowerCase().includes('sigiloso')) {
      if (op.valor_estimado && Number(op.valor_estimado) > 0) {
        resumo.valor_formatado = `R$ ${Number(op.valor_estimado).toLocaleString('pt-BR',{minimumFractionDigits:2})}`;
      }
    }
    resumo.valor_db = op.valor_estimado;

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
      `SELECT o.*, c.nome AS cliente_nome, c.whatsapp AS whatsapp_empresa,
              c.contato_whatsapp, c.whatsapp_grupo,
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

    console.log(`[Disparo] op.id=${op.id} | grupo="${op.whatsapp_grupo}" | contato_whatsapp="${op.contato_whatsapp}" | whatsapp_empresa="${op.whatsapp_empresa}"`);

    if (op.whatsapp_grupo) {
      try {
        const resGrupo = await zapiSvc.enviarGrupo(op.whatsapp_grupo, msgGrupo);
        console.log(`[Disparo] Grupo OK — phone="${op.whatsapp_grupo}" messageId="${resGrupo?.messageId}"`);
      } catch (e) {
        console.error(`[Disparo] Erro grupo — phone="${op.whatsapp_grupo}":`, e.response?.data || e.message);
        erros.push(`Grupo: ${e.message}`);
      }
    } else {
      console.log(`[Disparo] Sem grupo configurado para cliente`);
    }

    const dmPhone = op.contato_whatsapp || op.whatsapp_empresa;
    if (dmPhone) {
      console.log(`[Disparo] DM → phone="${dmPhone}" (${op.contato_whatsapp ? 'contato' : 'empresa (fallback)'})`);
      try {
        const resBotoes = await zapiSvc.enviarBotoes(
          dmPhone,
          '🔔 Nova Oportunidade',
          msgDM,
          'Conlicit Hub · hub.conlicit.com',
          [
            { id: `sim_${op.id}`, label: '✅ Vamos participar!' },
            { id: `nao_${op.id}`, label: '❌ Não tenho interesse' },
          ],
        );
        console.log(`[Disparo] DM botões OK — messageId="${resBotoes?.messageId}"`);
      } catch (eBotoes) {
        console.warn(`[Disparo] Botões falhou, tentando texto simples — ${eBotoes.response?.data?.message || eBotoes.message}`);
        try {
          const resTexto = await zapiSvc.enviarTexto(
            dmPhone,
            msgDM + '\n\nResponda *SIM* para participar ou *NÃO* para recusar.',
          );
          console.log(`[Disparo] DM texto OK — messageId="${resTexto?.messageId}"`);
        } catch (e2) {
          console.error(`[Disparo] DM texto falhou — phone="${dmPhone}":`, e2.response?.data || e2.message);
          erros.push(`DM: ${e2.message}`);
        }
      }
    } else {
      console.log(`[Disparo] Sem WhatsApp de DM configurado para cliente`);
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
      const { rows: [opFull] } = await db.query(
        `SELECT o.*, c.nome AS cliente_nome
         FROM oportunidades_fila o
         LEFT JOIN clientes c ON c.id = o.cliente_id
         WHERE o.id = $1`, [id],
      );

      if (opFull) {
        const { rows: [existente] } = await db.query(
          `SELECT id FROM pregoes WHERE cliente_id=$1 AND numero_controle_pncp=$2`,
          [opFull.cliente_id, opFull.numero_controle_pncp || opFull.edital_ref],
        );

        if (!existente) {
          const { rows: [pregao] } = await db.query(
            `INSERT INTO pregoes
               (cliente_id, numero, orgao, objeto, valor_estimado,
                data_abertura, data_hora_abertura, link_pncp,
                status, numero_controle_pncp)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'a_disputar',$9)
             RETURNING id`,
            [
              opFull.cliente_id,
              opFull.edital_ref || opFull.numero_controle_pncp,
              opFull.orgao,
              opFull.objeto,
              opFull.valor_estimado,
              opFull.data_abertura ? new Date(opFull.data_abertura).toISOString().split('T')[0] : null,
              opFull.data_abertura || null,
              opFull.link_pncp || opFull.link_edital,
              opFull.numero_controle_pncp || opFull.edital_ref,
            ],
          );

          if (pregao) {
            await db.query(
              `UPDATE oportunidades_fila SET pregao_id=$1 WHERE id=$2`,
              [pregao.id, id],
            ).catch(e => console.warn('[Oportunidades] Não foi possível vincular pregão:', e.message));
            console.log(`[Oportunidades] Pregão criado id=${pregao.id} para cliente ${opFull.cliente_nome} — ${opFull.objeto?.slice(0, 50)}`);

            // Notificar admin: cliente confirmou interesse — hora de preparar
            const adminWpp = process.env.ADMIN_WHATSAPP;
            if (adminWpp) {
              const dtStr = opFull.data_abertura
                ? new Date(opFull.data_abertura).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
                : '—';
              const msg =
                `✅ *Cliente confirmou interesse!*\n\n` +
                `👤 *Cliente:* ${opFull.cliente_nome}\n` +
                `📋 *Pregão:* ${opFull.objeto?.slice(0, 100)}\n` +
                `📅 *Data:* ${dtStr}\n\n` +
                `*Próximos passos:*\n` +
                `1. Enviar planilha de preços ao cliente\n` +
                `2. Verificar documentos de habilitação\n` +
                `3. Cadastrar no portal de disputa\n\n` +
                `Acesse o Hub para acompanhar: hub.conlicit.com`;
              zapiSvc.enviarTexto(adminWpp, msg).catch(e => console.warn('[Oportunidades] Notif admin falhou:', e.message));
            }
          }
        } else {
          console.log(`[Oportunidades] Pregão já existe id=${existente.id} para este edital`);
          await db.query(
            `UPDATE oportunidades_fila SET pregao_id=$1 WHERE id=$2`,
            [existente.id, id],
          ).catch(() => {});
        }
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[Oportunidades] registrarResposta:', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

// ── Excluir oportunidade da fila (sócio/admin) ──
async function excluir(req, res) {
  if (!['socio_fundador', 'admin'].includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM oportunidades_fila WHERE id=$1', [id]);
    if (!rowCount) return res.status(404).json({ erro: 'Oportunidade não encontrada' });
    return res.json({ ok: true });
  } catch (e) {
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
    const axios = require('axios');
    const BASE  = process.env.ZAPI_BASE_URL || 'https://api.z-api.io';
    const INST  = process.env.ZAPI_INSTANCE;
    const TOKEN = process.env.ZAPI_TOKEN;
    const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;
    const headers = {
      'Content-Type': 'application/json',
      ...(CLIENT_TOKEN ? { 'client-token': CLIENT_TOKEN } : {}),
    };

    const r = await axios.get(
      `${BASE}/instances/${INST}/token/${TOKEN}/chats`,
      { headers, timeout: 15000, params: { page: 1, pageSize: 100 } }
    );

    const todos = (Array.isArray(r.data) ? r.data : [])
      .filter(g => g.isGroup === true);

    todos.sort((a, b) => {
      const na = (a.name || a.subject || a.groupName || '').toLowerCase();
      const nb = (b.name || b.subject || b.groupName || '').toLowerCase();
      return na.localeCompare(nb);
    });

    return res.json(todos.map(g => ({
      id:   g.phone,
      nome: g.name || g.subject || g.groupName || g.phone,
    })));
  } catch (e) {
    console.error('[Grupos Z-API]', e.response?.data || e.message);
    return res.status(500).json({ erro: e.message, detalhes: e.response?.data });
  }
}

async function encaminhar(req, res) {
  if (!['socio_fundador', 'admin'].includes(req.usuario.role))
    return res.status(403).json({ erro: 'Sem permissão' });
  const { id } = req.params;
  const { operador_id, observacoes } = req.body;
  if (!operador_id) return res.status(400).json({ erro: 'operador_id obrigatório' });
  try {
    await db.query(
      `UPDATE oportunidades_fila SET operador_id=$1, operador_obs=$2 WHERE id=$3`,
      [operador_id, observacoes || null, id],
    );

    const { rows: [op] } = await db.query(
      `SELECT pregao_id, objeto, orgao FROM oportunidades_fila WHERE id=$1`, [id],
    );

    if (op?.pregao_id) {
      await db.query(
        `UPDATE pregoes SET operador_id=$1, operador_obs=$2 WHERE id=$3`,
        [operador_id, observacoes || null, op.pregao_id],
      );
    }

    const { rows: [usr] } = await db.query(
      `SELECT nome, email FROM usuarios WHERE id=$1`, [operador_id],
    );
    console.log(`[Encaminhar] op=${id} → ${usr?.nome || usr?.email} — ${op?.objeto?.slice(0, 40)}`);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Encaminhar]', e.message);
    return res.status(500).json({ erro: e.message });
  }
}

module.exports = { listar, buscarPorId, criar, gerarResumo, disparar, registrarResposta, webhookZapi, listarGrupos, excluir, encaminhar };
