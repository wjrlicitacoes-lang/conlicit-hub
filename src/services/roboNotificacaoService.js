/**
 * RobôLicit — roboNotificacaoService.js
 * Envia notificações WhatsApp via Z-API quando o robô ganha,
 * perde ou encontra erros num pregão.
 *
 * Reutiliza EXATAMENTE a mesma função enviarWhatsApp() do boletimService
 * e os mesmos ZAPI_INSTANCE / ZAPI_TOKEN do .env do Hub.
 *
 * Coloca em: conlicit-hub/src/services/roboNotificacaoService.js
 */

const axios = require('axios');
const db    = require('../database/db');

// ─────────────────────────────────────────────────────────────
// HELPER — reutilizado do boletimService
// ─────────────────────────────────────────────────────────────
function limparTelefone(tel) {
  const d = tel.replace(/\D/g, '');
  return d.startsWith('55') && d.length >= 12 ? d : '55' + d;
}

async function enviarWhatsApp(telefone, mensagem) {
  const instance  = process.env.ZAPI_INSTANCE;
  const zapiToken = process.env.ZAPI_TOKEN;
  if (!instance || !zapiToken) {
    console.warn('[RobôNotif] ZAPI_INSTANCE/ZAPI_TOKEN não configurados — WhatsApp ignorado');
    return null;
  }
  const { data } = await axios.post(
    `https://api.z-api.io/instances/${instance}/token/${zapiToken}/send-text`,
    { phone: limparTelefone(telefone), message: mensagem },
    { timeout: 15000 },
  );
  return data;
}

function formatarBRL(valor) {
  if (!valor) return '—';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function agora() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─────────────────────────────────────────────────────────────
// MONTAR MENSAGENS
// ─────────────────────────────────────────────────────────────

function mensagemVitoria({ pregao, cliente, lance, totalLances }) {
  return [
    `🏆 *VITÓRIA no Pregão!*`,
    ``,
    `📋 *Pregão:* ${pregao.numero || '—'}`,
    `🏢 *Cliente:* ${cliente.nome}`,
    pregao.orgao   ? `🏛️ *Órgão:* ${pregao.orgao}`   : null,
    pregao.objeto  ? `📝 *Objeto:* ${String(pregao.objeto).slice(0, 180)}` : null,
    ``,
    `💰 *Lance vencedor:* ${formatarBRL(lance)}`,
    `📊 *Total de lances dados:* ${totalLances}`,
    `🕐 *Encerrado em:* ${agora()}`,
    ``,
    `_Resultado gerado pelo RobôLicit — Conlicit Hub_`,
  ].filter(l => l !== null).join('\n');
}

function mensagemDerrota({ pregao, cliente, lance, totalLances }) {
  return [
    `❌ *Pregão não vencido*`,
    ``,
    `📋 *Pregão:* ${pregao.numero || '—'}`,
    `🏢 *Cliente:* ${cliente.nome}`,
    pregao.objeto ? `📝 *Objeto:* ${String(pregao.objeto).slice(0, 150)}` : null,
    ``,
    `🔻 *Menor lance dado:* ${formatarBRL(lance)}`,
    `📊 *Total de lances:* ${totalLances}`,
    `🕐 *Encerrado em:* ${agora()}`,
    ``,
    `_RobôLicit — Conlicit Hub_`,
  ].filter(l => l !== null).join('\n');
}

function mensagemErro({ pregao, cliente, motivo }) {
  return [
    `⚠️ *Erro no Robô de Lances*`,
    ``,
    `📋 *Pregão:* ${pregao.numero || '—'}`,
    `🏢 *Cliente:* ${cliente.nome}`,
    ``,
    `🔴 *Motivo:* ${motivo || 'Erro desconhecido'}`,
    `🕐 *Hora:* ${agora()}`,
    ``,
    `Acesse o Conlicit Hub → Monitor para verificar.`,
    `_RobôLicit — Conlicit Hub_`,
  ].filter(l => l !== null).join('\n');
}

function mensagemIniciado({ pregao, cliente, valorBase, valorMinimo }) {
  return [
    `⚡ *Robô iniciado para o pregão*`,
    ``,
    `📋 *Pregão:* ${pregao.numero || '—'}`,
    `🏢 *Cliente:* ${cliente.nome}`,
    pregao.objeto ? `📝 *Objeto:* ${String(pregao.objeto).slice(0, 150)}` : null,
    ``,
    `💰 *Valor base:* ${formatarBRL(valorBase)}`,
    `🔻 *Valor mínimo:* ${formatarBRL(valorMinimo)}`,
    `🕐 *Iniciado em:* ${agora()}`,
    ``,
    `_RobôLicit — Conlicit Hub_`,
  ].filter(l => l !== null).join('\n');
}

// ─────────────────────────────────────────────────────────────
// BUSCAR DESTINATÁRIOS
// ─────────────────────────────────────────────────────────────

/**
 * Retorna lista de telefones que devem receber a notificação:
 * 1. WhatsApp do cliente (campo clientes.whatsapp)
 * 2. WhatsApp do admin/operador responsável (process.env.ADMIN_WHATSAPP)
 */
async function buscarDestinatarios(pregao_id) {
  const { rows: [dados] } = await db.query(
    `SELECT
       p.numero, p.objeto, p.orgao,
       p.robo_valor_base, p.robo_valor_minimo,
       p.robo_ultimo_lance, p.robo_total_lances,
       c.nome    AS cliente_nome,
       c.whatsapp AS cliente_whatsapp,
       c.email   AS cliente_email
     FROM pregoes p
     JOIN clientes c ON c.id = p.cliente_id
     WHERE p.id = $1`,
    [pregao_id]
  );

  if (!dados) return { pregao: null, cliente: null, telefones: [] };

  const telefones = [];

  // WhatsApp do cliente
  if (dados.cliente_whatsapp) {
    telefones.push({ fone: dados.cliente_whatsapp, tipo: 'cliente' });
  }

  // WhatsApp do admin (configurado no .env)
  const adminFone = process.env.ADMIN_WHATSAPP;
  if (adminFone) {
    telefones.push({ fone: adminFone, tipo: 'admin' });
  }

  return {
    pregao: {
      numero: dados.numero,
      objeto: dados.objeto,
      orgao:  dados.orgao,
      robo_valor_base:    dados.robo_valor_base,
      robo_valor_minimo:  dados.robo_valor_minimo,
      robo_ultimo_lance:  dados.robo_ultimo_lance,
      robo_total_lances:  dados.robo_total_lances,
    },
    cliente: {
      nome:  dados.cliente_nome,
      email: dados.cliente_email,
    },
    telefones,
  };
}

// ─────────────────────────────────────────────────────────────
// FUNÇÕES PRINCIPAIS — chamadas pelo roboService
// ─────────────────────────────────────────────────────────────

async function notificarVitoria(pregao_id) {
  try {
    const { pregao, cliente, telefones } = await buscarDestinatarios(pregao_id);
    if (!pregao || !telefones.length) return;

    const msg = mensagemVitoria({
      pregao, cliente,
      lance:       pregao.robo_ultimo_lance,
      totalLances: pregao.robo_total_lances,
    });

    for (const { fone, tipo } of telefones) {
      try {
        await enviarWhatsApp(fone, msg);
        console.log(`[RobôNotif] ✅ Vitória enviada para ${tipo} (${fone})`);
      } catch (e) {
        console.error(`[RobôNotif] Erro ao enviar para ${tipo}: ${e.message}`);
      }
    }

    // Grava no banco que notificou
    await db.query(
      `UPDATE pregoes SET robo_resultado = 'vencido' WHERE id = $1`,
      [pregao_id]
    );

  } catch (e) {
    console.error('[RobôNotif] notificarVitoria:', e.message);
  }
}

async function notificarDerrota(pregao_id) {
  try {
    const { pregao, cliente, telefones } = await buscarDestinatarios(pregao_id);
    if (!pregao || !telefones.length) return;

    const msg = mensagemDerrota({
      pregao, cliente,
      lance:       pregao.robo_ultimo_lance,
      totalLances: pregao.robo_total_lances,
    });

    for (const { fone, tipo } of telefones) {
      try {
        await enviarWhatsApp(fone, msg);
        console.log(`[RobôNotif] Derrota enviada para ${tipo}`);
      } catch (e) {
        console.error(`[RobôNotif] Erro ao enviar para ${tipo}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error('[RobôNotif] notificarDerrota:', e.message);
  }
}

async function notificarErro(pregao_id, motivo) {
  try {
    const { pregao, cliente, telefones } = await buscarDestinatarios(pregao_id);
    if (!pregao || !telefones.length) return;

    const msg = mensagemErro({ pregao, cliente, motivo });

    // Erro só notifica o admin, não o cliente
    const admins = telefones.filter(t => t.tipo === 'admin');
    for (const { fone } of admins) {
      try {
        await enviarWhatsApp(fone, msg);
      } catch (e) {
        console.error(`[RobôNotif] Erro ao enviar erro para admin: ${e.message}`);
      }
    }
  } catch (e) {
    console.error('[RobôNotif] notificarErro:', e.message);
  }
}

async function notificarIniciado(pregao_id) {
  try {
    const { pregao, cliente, telefones } = await buscarDestinatarios(pregao_id);
    if (!pregao || !telefones.length) return;

    const msg = mensagemIniciado({
      pregao, cliente,
      valorBase:   pregao.robo_valor_base,
      valorMinimo: pregao.robo_valor_minimo,
    });

    // Iniciado → só notifica admin
    const adminFone = process.env.ADMIN_WHATSAPP;
    if (adminFone) {
      try {
        await enviarWhatsApp(adminFone, msg);
      } catch (e) {
        console.error(`[RobôNotif] Erro ao notificar início: ${e.message}`);
      }
    }
  } catch (e) {
    console.error('[RobôNotif] notificarIniciado:', e.message);
  }
}

module.exports = {
  notificarVitoria,
  notificarDerrota,
  notificarErro,
  notificarIniciado,
};
