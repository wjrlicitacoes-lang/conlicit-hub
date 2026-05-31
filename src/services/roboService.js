/**
 * RobôLicit — roboService.js
 * Gerencia os processos Python do robô dentro do Conlicit Hub.
 * 
 * Coloca em: conlicit-hub/src/services/roboService.js
 */

const { spawn } = require('child_process');
const path      = require('path');
const db        = require('../database/db');
const {
  notificarVitoria,
  notificarDerrota,
  notificarErro,
  notificarIniciado,
} = require('./roboNotificacaoService');

// Caminho para a pasta do robô Python (relativo à raiz do projeto)
const ROBO_DIR  = path.join(__dirname, '..', '..', 'robo-pregao');
const PYTHON    = process.platform === 'win32' ? 'python' : 'python3';

// Mapa em memória de processos ativos: pregao_id → { process, logs[] }
const processosAtivos = new Map();

// ──────────────────────────────────────────────────────────────
// INICIAR ROBÔ
// ──────────────────────────────────────────────────────────────
async function iniciarRobo({ pregao_id, cliente_id, usuario_id }) {

  // 1. Busca dados do pregão no banco
  const { rows: [pregao] } = await db.query(
    `SELECT p.*, c.nome AS cliente_nome,
            c.cred_comprasgov_login, c.cred_comprasgov_senha,
            c.cred_comprasnet_login, c.cred_comprasnet_senha,
            c.cred_bnc_login,        c.cred_bnc_senha,
            c.cred_licitanet_login,  c.cred_licitanet_senha
     FROM pregoes p
     JOIN clientes c ON c.id = p.cliente_id
     WHERE p.id = $1 AND p.cliente_id = $2`,
    [pregao_id, cliente_id]
  );

  if (!pregao) throw new Error('Pregão não encontrado');
  if (pregao.robo_status === 'rodando') throw new Error('Robô já está rodando neste pregão');

  // Auto-preenche via Edson se não configurado manualmente
  if (!pregao.robo_valor_base) {
    const { aplicarEstrategiaDoEdson } = require('./edsonRoboService');
    const edson = await aplicarEstrategiaDoEdson(pregao_id, cliente_id, false);
    if (edson.aplicado) {
      const { rows: [p2] } = await db.query(
        'SELECT * FROM pregoes p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = $1', [pregao_id]
      );
      Object.assign(pregao, p2);
      logger.info(`[Robô] Estratégia auto-aplicada via Edson (score ${edson.contexto?.score}/100)`);
    } else {
      throw new Error('Configure o Valor Base antes de iniciar (ou aguarde análise do Edson).');
    }
  }

  if (!pregao.robo_valor_minimo) throw new Error('Configure o Valor Mínimo antes de iniciar o robô');

  // 2. Determina a plataforma e credenciais
  const plataforma = normalizarPlataforma(pregao.portal_disputa);
  const credLogin  = pregao[`cred_${plataforma}_login`];
  const credSenha  = pregao[`cred_${plataforma}_senha`];

  if (!credLogin || !credSenha) {
    throw new Error(
      `Credenciais para ${plataforma} não configuradas para este cliente. ` +
      `Acesse Configurações do cliente e preencha login/senha da plataforma.`
    );
  }

  // 3. Grava config temporária para o Python ler
  const configPath = path.join(ROBO_DIR, `config_runtime_${pregao_id}.json`);
  const fs = require('fs');
  fs.writeFileSync(configPath, JSON.stringify({
    pregao_id,
    cliente_id,
    cliente_nome:  pregao.cliente_nome,
    numero_pregao: pregao.numero,
    link_pregao:   pregao.link_pncp || '',
    plataforma,
    valor_base:    parseFloat(pregao.robo_valor_base),
    valor_minimo:  parseFloat(pregao.robo_valor_minimo),
    estrategia: {
      modo:                   pregao.robo_estrategia    || 'moderado',
      reducao_pct:            parseFloat(pregao.robo_reducao_pct) || 0.5,
      modo_final:             pregao.robo_modo_final    || 'agressivo',
      entrar_so_se_perdendo:  true,
      intervalo_seg:          30,
    },
    credenciais: { login: credLogin, senha: credSenha },
  }, null, 2));

  // 4. Atualiza banco: robô iniciando
  await db.query(
    `UPDATE pregoes SET
       robo_status = 'iniciando',
       robo_iniciado_em = NOW(),
       robo_encerrado_em = NULL,
       robo_resultado = NULL,
       robo_total_lances = 0,
       robo_ultimo_lance = NULL
     WHERE id = $1`,
    [pregao_id]
  );

  // 5. Dispara o processo Python
  const processo = spawn(PYTHON, [
    path.join(ROBO_DIR, 'main.py'),
    '--config-runtime', configPath,
    '--headless',
  ], {
    cwd: ROBO_DIR,
    env: { ...process.env },
  });

  const logs = [];

  processo.stdout.on('data', async (data) => {
    const linha = data.toString().trim();
    logs.push({ ts: new Date().toISOString(), msg: linha });
    console.log(`[Robô #${pregao_id}] ${linha}`);

    // Detecta resultado via saída do Python
    if (linha.includes('GANHOU') || linha.includes('vencido')) {
      await _atualizarResultado(pregao_id, 'vencido', logs.length);
      notificarVitoria(pregao_id).catch(() => {});
    }
    if (linha.includes('STATUS:perdido')) {
      await _atualizarResultado(pregao_id, 'perdido', logs.length);
      notificarDerrota(pregao_id).catch(() => {});
    }
    if (linha.includes('Lance') && linha.includes('enviado')) {
      const match = linha.match(/R\$\s*([\d.,]+)/);
      if (match) {
        const valor = parseFloat(match[1].replace('.','').replace(',','.'));
        await db.query(
          `UPDATE pregoes SET robo_ultimo_lance = $1, robo_total_lances = robo_total_lances + 1 WHERE id = $2`,
          [valor, pregao_id]
        );
      }
    }
  });

  processo.stderr.on('data', (data) => {
    const linha = data.toString().trim();
    logs.push({ ts: new Date().toISOString(), msg: `[ERR] ${linha}` });
    console.error(`[Robô #${pregao_id} ERR] ${linha}`);
  });

  processo.on('close', async (code) => {
    console.log(`[Robô #${pregao_id}] Encerrado com código ${code}`);
    processosAtivos.delete(pregao_id);
    
    // Limpa config temporária
    try { fs.unlinkSync(configPath); } catch {}

    const resultado = code === 0 ? 'encerrado' : 'erro';
    await db.query(
      `UPDATE pregoes SET
         robo_status = 'encerrado',
         robo_encerrado_em = NOW(),
         robo_pid = NULL,
         robo_resultado = COALESCE(robo_resultado, $1)
       WHERE id = $2`,
      [resultado, pregao_id]
    );
    if (code !== 0) {
      notificarErro(pregao_id, `Processo encerrado com código ${code}`).catch(() => {});
    }
  });

  // 6. Registra processo ativo
  processosAtivos.set(pregao_id, { processo, logs, iniciado_em: new Date() });

  // 7. Atualiza PID e status no banco
  await db.query(
    `UPDATE pregoes SET robo_status = 'rodando', robo_pid = $1 WHERE id = $2`,
    [processo.pid, pregao_id]
  );
  notificarIniciado(pregao_id).catch(() => {});

  return { pid: processo.pid, mensagem: 'Robô iniciado com sucesso' };
}

// ──────────────────────────────────────────────────────────────
// PARAR ROBÔ
// ──────────────────────────────────────────────────────────────
async function pararRobo(pregao_id) {
  const ativo = processosAtivos.get(pregao_id);

  if (ativo) {
    ativo.processo.kill('SIGTERM');
    processosAtivos.delete(pregao_id);
  }

  await db.query(
    `UPDATE pregoes SET
       robo_status = 'parado',
       robo_encerrado_em = NOW(),
       robo_pid = NULL
     WHERE id = $1`,
    [pregao_id]
  );

  return { mensagem: 'Robô parado' };
}

// ──────────────────────────────────────────────────────────────
// STATUS DO ROBÔ
// ──────────────────────────────────────────────────────────────
async function statusRobo(pregao_id) {
  const { rows: [pregao] } = await db.query(
    `SELECT robo_status, robo_pid, robo_iniciado_em, robo_encerrado_em,
            robo_resultado, robo_ultimo_lance, robo_total_lances,
            robo_valor_base, robo_valor_minimo, robo_estrategia
     FROM pregoes WHERE id = $1`,
    [pregao_id]
  );

  if (!pregao) throw new Error('Pregão não encontrado');

  const ativo = processosAtivos.get(pregao_id);
  const logs  = ativo ? ativo.logs.slice(-50) : []; // últimas 50 linhas

  return { ...pregao, logs };
}

// ──────────────────────────────────────────────────────────────
// CONFIGURAR ESTRATÉGIA
// ──────────────────────────────────────────────────────────────
async function configurarEstrategia(pregao_id, cliente_id, dados) {
  const {
    valor_base, valor_minimo, estrategia,
    reducao_pct, modo_final
  } = dados;

  const { rows: [updated] } = await db.query(
    `UPDATE pregoes SET
       robo_valor_base   = $1,
       robo_valor_minimo = $2,
       robo_estrategia   = $3,
       robo_reducao_pct  = $4,
       robo_modo_final   = $5
     WHERE id = $6 AND cliente_id = $7
     RETURNING *`,
    [
      parseFloat(valor_base)   || null,
      parseFloat(valor_minimo) || null,
      estrategia  || 'moderado',
      parseFloat(reducao_pct) || 0.5,
      modo_final  || 'agressivo',
      pregao_id,
      cliente_id,
    ]
  );

  if (!updated) throw new Error('Pregão não encontrado');
  return updated;
}

// ──────────────────────────────────────────────────────────────
// SALVAR CREDENCIAIS DO CLIENTE
// ──────────────────────────────────────────────────────────────
async function salvarCredenciais(cliente_id, credenciais) {
  // credenciais = { comprasgov: { login, senha }, bnc: { login, senha }, ... }
  const campos = [];
  const valores = [];
  let idx = 1;

  for (const [plat, cred] of Object.entries(credenciais)) {
    if (cred.login !== undefined) {
      campos.push(`cred_${plat}_login = $${idx++}`);
      valores.push(cred.login || null);
    }
    if (cred.senha !== undefined) {
      campos.push(`cred_${plat}_senha = $${idx++}`);
      valores.push(cred.senha || null);
    }
  }

  if (campos.length === 0) throw new Error('Nenhuma credencial informada');

  valores.push(cliente_id);
  const { rows: [updated] } = await db.query(
    `UPDATE clientes SET ${campos.join(', ')} WHERE id = $${idx} RETURNING id, nome`,
    valores
  );

  if (!updated) throw new Error('Cliente não encontrado');
  return { mensagem: 'Credenciais salvas', cliente: updated.nome };
}

// ──────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ──────────────────────────────────────────────────────────────
function normalizarPlataforma(portal_disputa) {
  const mapa = {
    'comprasnet': 'comprasnet',
    'compras.gov': 'comprasgov',
    'comprasgov': 'comprasgov',
    'pncp': 'comprasgov',
    'bnc': 'bnc',
    'licitanet': 'licitanet',
    'bec/sp': 'bnc',
    'comprasbr': 'comprasgov',
  };
  const chave = (portal_disputa || 'comprasgov').toLowerCase();
  return mapa[chave] || 'comprasgov';
}

async function _atualizarResultado(pregao_id, resultado, total_lances) {
  await db.query(
    `UPDATE pregoes SET robo_resultado = $1, robo_total_lances = $2 WHERE id = $3`,
    [resultado, total_lances, pregao_id]
  );
}

module.exports = {
  iniciarRobo,
  pararRobo,
  statusRobo,
  configurarEstrategia,
  salvarCredenciais,
  processosAtivos,
};
