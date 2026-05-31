/**
 * RobôLicit — roboController.js
 * Controller Express que expõe as rotas do robô.
 *
 * Coloca em: conlicit-hub/src/controllers/roboController.js
 */

const roboService = require('../services/roboService');

// ──────────────────────────────────────────────────────────────
// POST /robo/:pregao_id/iniciar
// Inicia o robô para um pregão específico
// ──────────────────────────────────────────────────────────────
async function iniciar(req, res) {
  const pregao_id  = parseInt(req.params.pregao_id, 10);
  const cliente_id = req.body.cliente_id ? parseInt(req.body.cliente_id, 10) : null;
  const usuario_id = req.usuario.id;

  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id é obrigatório' });

  // Apenas admins, assistentes e sócio fundador podem iniciar o robô
  const rolesBloqueados = ['cliente', 'assistente_junior'];
  if (rolesBloqueados.includes(req.usuario.role)) {
    return res.status(403).json({ erro: 'Sem permissão para iniciar o robô' });
  }

  try {
    const resultado = await roboService.iniciarRobo({ pregao_id, cliente_id, usuario_id });
    return res.json(resultado);
  } catch (e) {
    console.error('[RoboCtrl] iniciar:', e.message);
    return res.status(400).json({ erro: e.message });
  }
}

// ──────────────────────────────────────────────────────────────
// POST /robo/:pregao_id/parar
// Para o robô em execução
// ──────────────────────────────────────────────────────────────
async function parar(req, res) {
  const pregao_id = parseInt(req.params.pregao_id, 10);
  try {
    const resultado = await roboService.pararRobo(pregao_id);
    return res.json(resultado);
  } catch (e) {
    console.error('[RoboCtrl] parar:', e.message);
    return res.status(400).json({ erro: e.message });
  }
}

// ──────────────────────────────────────────────────────────────
// GET /robo/:pregao_id/status
// Retorna status atual + últimos 50 logs do robô
// ──────────────────────────────────────────────────────────────
async function status(req, res) {
  const pregao_id = parseInt(req.params.pregao_id, 10);
  try {
    const dados = await roboService.statusRobo(pregao_id);
    return res.json(dados);
  } catch (e) {
    console.error('[RoboCtrl] status:', e.message);
    return res.status(404).json({ erro: e.message });
  }
}

// ──────────────────────────────────────────────────────────────
// PATCH /robo/:pregao_id/configurar
// Salva valor_base, valor_minimo e estratégia no pregão
// ──────────────────────────────────────────────────────────────
async function configurar(req, res) {
  const pregao_id  = parseInt(req.params.pregao_id, 10);
  const cliente_id = req.body.cliente_id ? parseInt(req.body.cliente_id, 10) : null;

  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id é obrigatório' });

  try {
    const dados = await roboService.configurarEstrategia(pregao_id, cliente_id, req.body);
    return res.json({ mensagem: 'Estratégia configurada', dados });
  } catch (e) {
    console.error('[RoboCtrl] configurar:', e.message);
    return res.status(400).json({ erro: e.message });
  }
}

// ──────────────────────────────────────────────────────────────
// PATCH /robo/credenciais/:cliente_id
// Salva credenciais de plataformas para o cliente
// ──────────────────────────────────────────────────────────────
async function credenciais(req, res) {
  const cliente_id = parseInt(req.params.cliente_id, 10);

  // Sócio fundador e admin podem salvar de qualquer cliente
  // Cliente só pode salvar as próprias
  if (req.usuario.role === 'cliente' && req.usuario.cliente_id !== cliente_id) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  try {
    const resultado = await roboService.salvarCredenciais(cliente_id, req.body);
    return res.json(resultado);
  } catch (e) {
    console.error('[RoboCtrl] credenciais:', e.message);
    return res.status(400).json({ erro: e.message });
  }
}

// ──────────────────────────────────────────────────────────────
// GET /robo/ativos
// Lista todos os robôs em execução no momento
// ──────────────────────────────────────────────────────────────
async function listarAtivos(req, res) {
  const ativos = [];
  for (const [pregao_id, info] of roboService.processosAtivos.entries()) {
    ativos.push({
      pregao_id,
      pid: info.processo.pid,
      iniciado_em: info.iniciado_em,
      logs_count: info.logs.length,
    });
  }
  return res.json({ total: ativos.length, dados: ativos });
}

module.exports = { iniciar, parar, status, configurar, credenciais, listarAtivos };
