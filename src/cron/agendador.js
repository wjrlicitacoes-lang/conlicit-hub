const cron    = require('node-cron');
const axios   = require('axios');
const { Resend } = require('resend');
const { dispararBoletim } = require('../services/boletimService');
const { sincronizarPNCP } = require('../services/pncpSyncService');
const { processarAlertas } = require('../services/alertasService');
const zapiSvc = require('../services/zapiService');
const db      = require('../database/db');
const { processarOportunidadesParaCliente } = require('../services/oportunidadesHub');

const ALERTA_WPP   = process.env.ADMIN_WHATSAPP || '5531972460237';
const ALERTA_EMAIL = process.env.ADMIN_EMAIL    || 'wjrlicitacoes@gmail.com';

const LIMITE_SALDO_USD = 3;

async function verificarSaldoAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  try {
    const resp = await axios.get('https://api.anthropic.com/v1/usage', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      timeout: 10000,
    });

    const creditos = resp.data?.remaining_credits ?? resp.data?.balance ?? null;
    const saldoUSD = creditos != null ? parseFloat(creditos) : null;

    if (saldoUSD !== null && saldoUSD < LIMITE_SALDO_USD) {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        console.warn('[Cron] Saldo Anthropic baixo mas RESEND_API_KEY não configurada');
        return;
      }
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: 'Conlicit Hub <noreply@hub.conlicit.com>',
        to: ALERTA_EMAIL,
        subject: '⚠️ Conlicit Hub — Créditos Anthropic baixos',
        html: `<p>Saldo atual: <strong>$${saldoUSD.toFixed(2)}</strong>.</p>
               <p>O Edson pode parar de funcionar. Recarregue em <a href="https://console.anthropic.com">console.anthropic.com</a>.</p>`,
      });
      console.warn(`[Cron] Alerta enviado — saldo Anthropic: $${saldoUSD}`);
    } else {
      console.log(`[Cron] Saldo Anthropic ok: $${saldoUSD}`);
    }
  } catch (e) {
    console.error('[Cron] Erro ao verificar saldo Anthropic:', e.message);
  }
}

async function migrarColunaFollowup() {
  try {
    await db.query(
      `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS followup_enviado BOOLEAN DEFAULT FALSE`,
    );
  } catch (e) {
    console.error('[Cron] Migração followup_enviado:', e.message);
  }
}

function iniciarAgendador() {
  migrarColunaFollowup();
  // Sincronização do cache PNCP — todo dia às 6h (antes do boletim das 7h)
  const cronSync = process.env.SYNC_CRON || '0 6 * * *';
  cron.schedule(
    cronSync,
    async () => {
      console.log('[Cron] Iniciando sincronização diária do PNCP...');
      try {
        await sincronizarPNCP({ diasAdiante: 60 });
      } catch (e) {
        console.error('[Cron] Erro na sincronização:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );

  // Boletim automático — todo dia às 7h
  const cronBoletim = process.env.BOLETIM_CRON || '0 7 * * *';
  cron.schedule(
    cronBoletim,
    async () => {
      console.log('[Cron] Disparando boletim automático...');
      try {
        await dispararBoletim();
      } catch (e) {
        console.error('[Cron] Erro no boletim automático:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );

  // Alertas de pregão — a cada 30 min
  cron.schedule(
    '*/30 * * * *',
    async () => {
      try {
        await processarAlertas();
      } catch (e) {
        console.error('[Cron] Erro nos alertas:', e.message);
      }
    },
    { timezone: 'America/Sao_Paulo' },
  );

  // Verificação de saldo Anthropic — a cada 6 horas
  cron.schedule(
    '0 */6 * * *',
    async () => {
      console.log('[Cron] Verificando saldo Anthropic...');
      await verificarSaldoAnthropic();
    },
    { timezone: 'America/Sao_Paulo' },
  );

  // Cobrança automática de resposta de oportunidades — a cada hora
  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Verificando cobranças de oportunidades...');
    try {
      const agora = new Date();
      const { rows } = await db.query(
        `SELECT o.*, c.contato_whatsapp, c.nome AS cliente_nome
         FROM oportunidades_fila o
         LEFT JOIN clientes c ON c.id = o.cliente_id
         WHERE o.status = 'disparado' AND o.disparado_em IS NOT NULL`,
      );

      for (const op of rows) {
        const horasDesde = (agora - new Date(op.disparado_em)) / 3600000;
        if (!op.contato_whatsapp) continue;

        if (horasDesde >= 24 && !op.cobranca_1_em) {
          try {
            await zapiSvc.enviarTexto(op.contato_whatsapp,
              `Olá! 👋 Passando para lembrar sobre a oportunidade de licitação que enviamos ontem.\n\n` +
              `*${op.objeto}*\n\n` +
              `O prazo está se aproximando. Você tem interesse em participar?\n\n` +
              `Responda *SIM* para participar ou *NÃO* para recusar.`,
            );
            await db.query(`UPDATE oportunidades_fila SET cobranca_1_em=NOW() WHERE id=$1`, [op.id]);
            console.log(`[Cron] Cobrança 1 enviada — oportunidade ${op.id}`);
          } catch (e) { console.error(`[Cron] Erro cobrança 1 op ${op.id}:`, e.message); }
        }

        if (horasDesde >= 48 && !op.cobranca_2_em) {
          try {
            await zapiSvc.enviarTexto(op.contato_whatsapp,
              `⚠️ Último aviso sobre a oportunidade:\n\n*${op.objeto}*\n\n` +
              `O prazo para decisão está encerrando. Nossa equipe entrará em contato.\n\n` +
              `Responda *SIM* para participar ou *NÃO* para recusar.`,
            );
            await db.query(`UPDATE oportunidades_fila SET cobranca_2_em=NOW() WHERE id=$1`, [op.id]);
            const { rows: admins } = await db.query(
              `SELECT nome FROM usuarios WHERE role IN ('socio_fundador','admin') LIMIT 3`,
            );
            console.warn(`[ALERTA] Oportunidade ${op.id} sem resposta há 48h — cliente ${op.cliente_nome}. Admins: ${admins.map(a => a.nome).join(', ')}`);
          } catch (e) { console.error(`[Cron] Erro cobrança 2 op ${op.id}:`, e.message); }
        }

        if (horasDesde >= 72 && !op.resposta_em) {
          await db.query(`UPDATE oportunidades_fila SET status='expirado' WHERE id=$1`, [op.id]);
          console.log(`[Cron] Oportunidade ${op.id} expirada após 72h`);
        }
      }
    } catch (e) {
      console.error('[Cron] Erro no job de cobranças:', e.message);
    }
  }, { timezone: 'America/Sao_Paulo' });


  // Alerta de documentos vencendo — todo dia às 08:00 (Brasília)
  cron.schedule('0 8 * * *', async () => {
    console.log('[Cron] Verificando vencimento de documentos...');
    try {
      const { rows } = await db.query(`
        SELECT dc.*, c.nome AS cliente_nome, c.whatsapp AS cliente_wpp
        FROM documentos_cliente dc
        JOIN clientes c ON c.id = dc.cliente_id
        WHERE dc.data_vencimento IS NOT NULL
          AND dc.status IN ('enviado','aprovado')
          AND dc.data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        ORDER BY dc.data_vencimento
      `);

      const TIPO_LABEL = {
        contrato_social:'Contrato Social',
        certidao_federal:'Certidão Federal',
        certidao_estadual:'Certidão Estadual',
        certidao_municipal:'Certidão Municipal',
        atestado_capacidade_tecnica:'Atestado Técnico',
        balanco_patrimonial:'Balanço Patrimonial',
        rg_socio:'RG dos Sócios',
        cpf_socio:'CPF dos Sócios',
      };

      for (const doc of rows) {
        const venc = new Date(doc.data_vencimento);
        const dias = Math.ceil((venc - new Date()) / 86400000);
        const label = TIPO_LABEL[doc.tipo] || doc.tipo;
        const dtStr = venc.toLocaleDateString('pt-BR');

        if (dias <= 7) {
          console.warn(`⚠️  VENCIMENTO: ${doc.cliente_nome} — ${label} vence em ${dias} dias (${dtStr})`);
          // TODO: integrar Z-API quando configurado para enviar WPP ao cliente
        } else {
          console.log(`[Docs] ${doc.cliente_nome} — ${label}: ${dias} dias (${dtStr})`);
        }
      }
    } catch (e) {
      console.error('[Cron] Erro no alerta de vencimento:', e.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[Cron] Alerta de vencimento de documentos agendado: 0 8 * * * (America/Sao_Paulo)');

  // Follow-up automático de prospects — todo dia às 9h
  cron.schedule('0 9 * * *', async () => {
    console.log('[Cron] Iniciando follow-up de prospects...');
    try {
      const { rows: prospects } = await db.query(`
        SELECT * FROM prospects
        WHERE status = 'resumo_enviado'
          AND updated_at <= NOW() - INTERVAL '24 hours'
          AND followup_enviado IS NOT TRUE
          AND email IS NOT NULL
      `);

      if (!prospects.length) {
        console.log('[Cron] Nenhum prospect para follow-up.');
        return;
      }

      const { readFile } = require('fs').promises;
      const path = require('path');
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        console.warn('[Cron] RESEND_API_KEY não configurada — follow-up cancelado');
        return;
      }
      const resend = new Resend(resendKey);

      const templatePath = path.join(__dirname, '../../public/emails/email-followup-prospect.html');
      const templateBase = await readFile(templatePath, 'utf8');

      const PS_MAP = {
        saude:      'P.S.: A maioria dos editais de saúde e medicamentos exige habilitação técnica e certidão CRF. O Conlicit já tem checklist pronto pra isso.',
        alimentacao:'P.S.: Editais de merenda escolar têm exigências da ANVISA e PNAE. O Conlicit monitora e filtra só os que se encaixam no seu perfil.',
        obras:      'P.S.: Licitações de obras têm prazo mínimo de 25 dias úteis por lei. O Conlicit captura antes da maioria saber que existe.',
        limpeza:    'P.S.: Editais de limpeza e conservação saem toda semana nas prefeituras da RMBH. Eu te aviso por WhatsApp antes do prazo fechar.',
        escritorio: 'P.S.: Material de escritório costuma ter pregão eletrônico com SRP — você pode fornecer para vários órgãos com um só cadastro.',
        ti:         'P.S.: Licitações de TI e software costumam ter menos concorrentes qualificados. É um nicho com boa margem pra quem conhece o processo.',
        seguranca:  'P.S.: Editais de segurança e vigilância exigem registro na SSP. O Conlicit já filtra só os que cabem no seu CNAE.',
        manutencao: 'P.S.: Manutenção predial tem alta demanda nas prefeituras da RMBH. Posso te avisar assim que sair o próximo.',
        transporte: 'P.S.: Licitações de transporte e veículos costumam exigir registro ANTT. O Conlicit verifica isso antes de te avisar.',
        epi:        'P.S.: EPI e uniformes têm pregão quase toda semana. O Conlicit monitora por CNAE e te avisa antes do prazo fechar.',
      };

      for (const prospect of prospects) {
        try {
          const trechoObjeto = prospect.edital
            ? `"${prospect.edital.slice(0, 60)}${prospect.edital.length > 60 ? '…' : ''}"`
            : 'enviado anteriormente';
          const psNicho = PS_MAP[prospect.segmento]
            || 'P.S.: Se quiser, posso monitorar automaticamente os editais do seu segmento e te avisar no WhatsApp antes dos prazos fecharem.';

          const html = templateBase
            .replace(/\{\{NOME\}\}/g,         prospect.nome || '')
            .replace(/\{\{EMPRESA\}\}/g,       prospect.empresa || 'sua empresa')
            .replace(/\{\{TRECHO_OBJETO\}\}/g, trechoObjeto)
            .replace(/\{\{PS_NICHO\}\}/g,      psNicho);

          await resend.emails.send({
            from: process.env.BOLETIM_FROM_EMAIL || 'Conlicit <onboarding@resend.dev>',
            to: prospect.email,
            subject: `Você teve chance de ver o resumo do edital?`,
            html,
          });

          await db.query(
            `UPDATE prospects SET status='em_followup', followup_enviado=TRUE, updated_at=NOW() WHERE id=$1`,
            [prospect.id],
          );

          await db.query(
            `INSERT INTO prospects_eventos (prospect_id, tipo, descricao)
             VALUES ($1, 'followup_enviado', $2)`,
            [prospect.id, `Email de follow-up enviado para ${prospect.email}`],
          );

          console.log(`[Cron] Follow-up enviado — prospect ${prospect.id} (${prospect.nome})`);
        } catch (e) {
          console.error(`[Cron] Erro no follow-up do prospect ${prospect.id}:`, e.message);
        }
      }
    } catch (e) {
      console.error('[Cron] Erro no job de follow-up:', e.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[Cron] Follow-up de prospects agendado: 0 9 * * * (America/Sao_Paulo)');

  // ── JOB Hub: processar oportunidades por cliente — 7h30 (após PNCP sync)
  cron.schedule('30 7 * * *', async () => {
    console.log('[Cron Hub] Iniciando processamento de oportunidades por cliente...');
    try {
      const { rows: clientes } = await db.query(
        `SELECT * FROM clientes WHERE ativo = true AND municipio_base IS NOT NULL`,
      );
      for (const cliente of clientes) {
        try {
          const stats = await processarOportunidadesParaCliente(cliente);
          if (stats.enviados > 0 || stats.alertas_urgentes > 0) {
            console.log(`[Cron Hub] ${cliente.nome}: ${stats.enviados} enviadas, ${stats.alertas_urgentes} alertas urgentes`);
          }
        } catch (e) {
          console.error(`[Cron Hub] Erro cliente ${cliente.nome}:`, e.message);
        }
      }
    } catch (e) {
      console.error('[Cron Hub] Erro no job de oportunidades:', e.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── JOB Hub: lembretes de 3 dias — 8h30
  cron.schedule('30 8 * * *', async () => {
    console.log('[Cron Hub] Verificando lembretes de 3 dias...');
    try {
      const { rows: eventos } = await db.query(
        `SELECT cc.*, c.nome AS cliente_nome FROM calendario_conlicit cc
         LEFT JOIN clientes c ON c.id = cc.cliente_id
         WHERE cc.data_encerramento = CURRENT_DATE + 3
           AND cc.lembrete_3dias_enviado = false`,
      );
      for (const ev of eventos) {
        const msg =
          `⚠️ *Lembrete: Pregão encerrando em 3 dias!*\n\n` +
          `📋 ${ev.titulo}\n` +
          `📅 Encerra: ${new Date(ev.data_encerramento).toLocaleDateString('pt-BR')}\n` +
          `💰 R$ ${ev.valor_estimado ? Number(ev.valor_estimado).toLocaleString('pt-BR') : 'Não informado'}\n` +
          `🖥️ ${ev.plataforma || 'Não informada'}\n\n` +
          `Verifique se planilha e documentação estão prontos.\n` +
          `Acesse: https://web-production-18d79.up.railway.app`;

        try {
          await zapiSvc.enviarTexto(ALERTA_WPP, msg);
        } catch (e) {
          console.error('[Cron Hub] Erro Z-API lembrete:', e.message);
        }

        try {
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey) {
            const resend = new Resend(resendKey);
            await resend.emails.send({
              from: 'Conlicit Hub <noreply@hub.conlicit.com>',
              to: ALERTA_EMAIL,
              subject: `⚠️ Lembrete 3 dias — ${ev.titulo}`,
              html: `<p><strong>${ev.titulo}</strong></p><p>Encerramento: ${new Date(ev.data_encerramento).toLocaleDateString('pt-BR')}</p><p>Plataforma: ${ev.plataforma || 'Não informada'}</p><p>Verifique planilha e documentação.</p>`,
            });
          }
        } catch (e) {
          console.error('[Cron Hub] Erro Resend lembrete:', e.message);
        }

        await db.query(
          'UPDATE calendario_conlicit SET lembrete_3dias_enviado=true WHERE id=$1',
          [ev.id],
        );
      }
    } catch (e) {
      console.error('[Cron Hub] Erro no job de lembretes:', e.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── JOB Hub: expirar oportunidades vencidas — meia-noite
  cron.schedule('0 0 * * *', async () => {
    try {
      const { rowCount } = await db.query(
        `UPDATE oportunidades SET status='expirado'
         WHERE data_encerramento < CURRENT_DATE
           AND status IN ('aguardando_resposta','alerta_urgente_enviado')`,
      );
      if (rowCount > 0) console.log(`[Cron Hub] ${rowCount} oportunidade(s) expirada(s)`);
    } catch (e) {
      console.error('[Cron Hub] Erro ao expirar oportunidades:', e.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  console.log(`[Cron] Sync PNCP agendado: "${cronSync}" (America/Sao_Paulo)`);
  console.log(`[Cron] Boletim agendado: "${cronBoletim}" (America/Sao_Paulo)`);
  console.log('[Cron] Alertas de pregão agendados: */30 * * * * (America/Sao_Paulo)');
  console.log('[Cron] Verificação saldo Anthropic agendada: 0 */6 * * * (America/Sao_Paulo)');
  console.log('[Cron] Cobranças de oportunidades agendadas: 0 * * * * (America/Sao_Paulo)');
  console.log('[Cron Hub] Oportunidades por cliente: 30 7 * * * (America/Sao_Paulo)');
  console.log('[Cron Hub] Lembretes 3 dias: 30 8 * * * (America/Sao_Paulo)');
  console.log('[Cron Hub] Expirar oportunidades: 0 0 * * * (America/Sao_Paulo)');
}

module.exports = { iniciarAgendador };
