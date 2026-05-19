const express = require('express');
const router = express.Router();
const editaisController = require('../controllers/editaisController');
const { sincronizarPNCP } = require('../services/pncpSyncService');

// Lista editais com filtros (usa cache local se populado, fallback ao PNCP)
router.get('/', editaisController.listarEditais);

// Busca edital específico por CNPJ/ano/sequencial
router.get('/:cnpj/:ano/:sequencial', editaisController.buscarEditalPorId);

// Dispara a sincronização do cache local com o PNCP
// POST /editais/sincronizar?diasAdiante=90
router.post('/sincronizar', async (req, res) => {
  const diasAdiante = Math.min(Number(req.query.diasAdiante) || 90, 365);
  console.log(`[Sync] Requisição manual: diasAdiante=${diasAdiante}`);

  // Responde imediatamente — a sincronização continua em background
  res.json({
    mensagem: `Sincronização iniciada para os próximos ${diasAdiante} dias. Acompanhe os logs do servidor.`,
    diasAdiante,
  });

  sincronizarPNCP({ diasAdiante }).catch((e) =>
    console.error('[Sync] Erro na sincronização manual:', e.message),
  );
});

module.exports = router;
