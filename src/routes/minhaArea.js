const router = require('express').Router();
const { getMinhaArea }  = require('../services/minhaArea');
const { getMeusPregoes } = require('../services/meusPregoes');

router.get('/', async (req, res) => {
  try {
    const dados = await getMinhaArea(req.usuario.id);
    return res.json(dados);
  } catch (e) {
    console.error('[MinhaArea]', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

router.get('/pregoes', async (req, res) => {
  try {
    const dados = await getMeusPregoes(req.usuario.id);
    return res.json(dados);
  } catch (e) {
    console.error('[MeusPregoes]', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
