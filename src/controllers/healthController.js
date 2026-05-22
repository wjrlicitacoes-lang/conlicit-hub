const db = require('../database/db');

async function verificarSaude(req, res) {
  let banco = false;
  let database_erro = null;
  let ultimo_sync_pncp = null;
  let ultimo_boletim = null;

  try {
    await db.query('SELECT 1');
    banco = true;

    const syncRes = await db.query(
      `SELECT MAX(sincronizado_em) AS ts FROM editais_cache`,
    );
    ultimo_sync_pncp = syncRes.rows[0]?.ts ?? null;

    const boletimRes = await db.query(
      `SELECT MAX(created_at) AS ts
       FROM mensalidades
       WHERE status = 'recebido'
       LIMIT 1`,
    );
    const chatRes = await db.query(
      `SELECT MAX(criado_em) AS ts FROM chat_edson LIMIT 1`,
    );
    ultimo_boletim = chatRes.rows[0]?.ts ?? null;
  } catch (e) {
    database_erro = e.message;
  }

  res.json({
    status: 'ok',
    banco,
    anthropic_configurado: !!process.env.ANTHROPIC_API_KEY,
    ultimo_sync_pncp,
    ultimo_boletim,
    railway_url: process.env.RAILWAY_PUBLIC_DOMAIN || 'local',
    ...(database_erro && { database_erro }),
    timestamp: new Date().toISOString(),
  });
}

module.exports = { verificarSaude };
