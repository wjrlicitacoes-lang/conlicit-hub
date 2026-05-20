const cron = require('node-cron');
const { dispararBoletim } = require('../services/boletimService');
const { sincronizarPNCP } = require('../services/pncpSyncService');
const { processarAlertas } = require('../services/alertasService');

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

  console.log(`[Cron] Sync PNCP agendado: "${cronSync}" (America/Sao_Paulo)`);
  console.log(`[Cron] Boletim agendado: "${cronBoletim}" (America/Sao_Paulo)`);
  console.log('[Cron] Alertas de pregão agendados: */30 * * * * (America/Sao_Paulo)');
}

module.exports = { iniciarAgendador };
