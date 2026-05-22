const cron = require('node-cron');
const axios = require('axios');
const { Resend } = require('resend');
const { dispararBoletim } = require('../services/boletimService');
const { sincronizarPNCP } = require('../services/pncpSyncService');
const { processarAlertas } = require('../services/alertasService');

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

  console.log(`[Cron] Sync PNCP agendado: "${cronSync}" (America/Sao_Paulo)`);
  console.log(`[Cron] Boletim agendado: "${cronBoletim}" (America/Sao_Paulo)`);
  console.log('[Cron] Alertas de pregão agendados: */30 * * * * (America/Sao_Paulo)');
  console.log('[Cron] Verificação saldo Anthropic agendada: 0 */6 * * * (America/Sao_Paulo)');
}

module.exports = { iniciarAgendador };
