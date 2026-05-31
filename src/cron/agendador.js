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
    // /v1/usage não existe na API pública da Anthropic — usa /v1/models como ping
    const resp = await axios.get('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      timeout: 10000,
    });

    if (resp.status === 200) {
      console.log('[Cron] Verificação Anthropic ok — API key válida e ativa');
    }
  } catch (e) {
    const status = e.response?.status;
    const resendKey = process.env.RESEND_API_KEY;

    // 401 = key inválida ou sem créditos — envia alerta
    if (status === 401 && resendKey) {
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: 'Conlicit Hub <noreply@hub.conlicit.com>',
        to: ALERTA_EMAIL,
        subject: '⚠️ Conlicit Hub — API key Anthropic inválida ou sem créditos',
        html: `<p>A API key da Anthropic retornou erro <strong>401</strong>.</p>
               <p>O Edson pode estar fora do ar. Verifique em <a href="https://console.anthropic.com">console.anthropic.com</a>.</p>`,
      }).catch(err => console.error('[Cron] Falha ao enviar alerta Anthropic:', err.message));
      console.warn('[Cron] Alerta enviado — API key Anthropic com problema (401)');
    } else {
      console.warn(`[Cron] Verificação Anthropic falhou: ${status || e.message}`);
    }
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

  console.log(`[Cron] Sync PNCP agendado: "${cronSync}" (America/Sao_Paulo)`);
  console.log(`[Cron] Boletim agendado: "${cronBoletim}" (America/Sao_Paulo)`);
  console.log('[Cron] Alertas de pregão agendados: */30 * * * * (America/Sao_Paulo)');
  console.log('[Cron] Verificação saldo Anthropic agendada: 0 */6 * * * (America/Sao_Paulo)');
  console.log('[Cron] Cobranças de oportunidades agendadas: 0 * * * * (America/Sao_Paulo)');
}

module.exports = { iniciarAgendador };
