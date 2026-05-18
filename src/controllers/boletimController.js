const { dispararBoletim } = require('../services/boletimService');

async function disparar(req, res) {
  console.log(`[Boletim] Disparo manual solicitado por ${req.usuario?.email}`);
  try {
    const resultado = await dispararBoletim();
    return res.json({ mensagem: 'Boletim disparado com sucesso', resultado });
  } catch (erro) {
    console.error('[Boletim] Erro no disparo:', erro);
    return res.status(500).json({ erro: 'Erro ao disparar boletim', detalhe: erro.message });
  }
}

module.exports = { disparar };
