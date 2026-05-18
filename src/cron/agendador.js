const cron = require('node-cron');
const { dispararBoletim } = require('../services/boletimService');

function iniciarAgendador() {
  // Padrão: todo dia às 7h no horário de Brasília
  const schedule = process.env.BOLETIM_CRON || '0 7 * * *';

  cron.schedule(
    schedule,
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

  console.log(`[Cron] Boletim agendado: "${schedule}" (America/Sao_Paulo)`);
}

module.exports = { iniciarAgendador };
