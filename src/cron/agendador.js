const cron    = require('node-cron');
const axios   = require('axios');
const { Resend } = require('resend');
const { dispararBoletim } = require('../services/boletimService');
const { sincronizarPNCP } = require('../services/pncpSyncService');
const { processarAlertas } = require('../services/alertasService');
const zapiSvc = require('../services/zapiService');
const db      = require('../database/db');

const ALERTA_EMAIL = 'wjrlicitacoes@gmail.com';
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

function iniciarAgendador() {
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

  console.log(`[Cron] Sync PNCP agendado: "${cronSync}" (America/Sao_Paulo)`);
  console.log(`[Cron] Boletim agendado: "${cronBoletim}" (America/Sao_Paulo)`);
  console.log('[Cron] Alertas de pregão agendados: */30 * * * * (America/Sao_Paulo)');
  console.log('[Cron] Verificação saldo Anthropic agendada: 0 */6 * * * (America/Sao_Paulo)');
  console.log('[Cron] Cobranças de oportunidades agendadas: 0 * * * * (America/Sao_Paulo)');
}

module.exports = { iniciarAgendador };
