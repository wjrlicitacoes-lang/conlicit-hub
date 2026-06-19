const router = require('express').Router();
const db      = require('../database/db');
const zapiSvc = require('../services/zapiService');
const { processarConfirmacaoCliente } = require('../services/posConfirmacao');

function normalizarResposta(texto) {
  const t = (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  if (/^(SIM|S|QUERO|TENHO INTERESSE)$/.test(t)) return 'sim';
  if (/^(NAO|NÃO|N|NOPE|PASSAR)$/.test(t)) return 'nao';
  return null;
}

// POST /webhook/whatsapp — chamado pela Z-API sem autenticação JWT
router.post('/whatsapp', async (req, res) => {
  try {
    const body = req.body || {};

    // Z-API payload — extrair número e texto
    const numero = (
      body.phone ||
      body.sender ||
      body.from ||
      body?.message?.phone ||
      ''
    ).replace(/\D/g, '');

    const texto = (
      body.text?.message ||
      body.body ||
      body?.message?.text?.message ||
      body?.message?.body ||
      ''
    );

    if (!numero || !texto) return res.sendStatus(200);

    const resposta = normalizarResposta(texto);
    if (!resposta) return res.sendStatus(200);

    // Buscar oportunidade ativa do cliente por número
    const { rows } = await db.query(
      `SELECT o.* FROM oportunidades o
       JOIN clientes c ON c.id = o.cliente_id
       WHERE c.whatsapp = $1
         AND o.status IN ('aguardando_resposta','alerta_urgente_enviado')
       ORDER BY o.criado_em DESC LIMIT 1`,
      [numero],
    );

    if (!rows.length) return res.sendStatus(200);
    const op = rows[0];

    if (resposta === 'sim') {
      await db.query(
        `UPDATE oportunidades SET status='interesse', data_resposta=now() WHERE id=$1`,
        [op.id],
      );
      try {
        await processarConfirmacaoCliente(op.id);
      } catch (e) {
        console.error('[Webhook WPP] Erro pós-confirmação:', e.message);
      }
    } else {
      await db.query(
        `UPDATE oportunidades SET status='sem_interesse', data_resposta=now() WHERE id=$1`,
        [op.id],
      );
      // Buscar whatsapp do cliente para responder
      const { rows: [cli] } = await db.query(
        'SELECT whatsapp FROM clientes WHERE id=$1', [op.cliente_id],
      );
      if (cli?.whatsapp) {
        try {
          await zapiSvc.enviarTexto(
            cli.whatsapp,
            'Entendido! Continuaremos monitorando novas oportunidades para você. 👍',
          );
        } catch (e) {
          console.error('[Webhook WPP] Erro Z-API resposta negativa:', e.message);
        }
      }
    }
  } catch (e) {
    console.error('[Webhook WPP] Erro geral:', e.message);
  }

  // Sempre retorna 200 para a Z-API
  return res.sendStatus(200);
});

module.exports = router;
