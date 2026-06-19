const { Resend } = require('resend');
const db      = require('../database/db');
const zapiSvc = require('./zapiService');

const DIRETORA_WPP   = process.env.ADMIN_WHATSAPP || '5531982388210';
const DIRETORA_EMAIL = process.env.ADMIN_EMAIL    || 'wjrlicitacoes@gmail.com';
const HUB_URL        = 'https://web-production-18d79.up.railway.app';

function formatarMoeda(valor) {
  if (!valor) return 'Não informado';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(data) {
  if (!data) return 'Não informada';
  return new Date(data).toLocaleDateString('pt-BR');
}

async function processarConfirmacaoCliente(oportunidadeId) {
  const { rows } = await db.query(
    `SELECT o.*, c.nome AS cliente_nome, c.whatsapp AS cliente_wpp
     FROM oportunidades o
     JOIN clientes c ON c.id = o.cliente_id
     WHERE o.id = $1`,
    [oportunidadeId],
  );
  if (!rows.length) throw new Error(`Oportunidade ${oportunidadeId} não encontrada`);
  const op = rows[0];

  // 1. Criar 3 tarefas internas
  await db.query(
    `INSERT INTO tarefas_internas (oportunidade_id, cliente_id, tipo, atribuido_para_role)
     VALUES
       ($1, $2, 'gerar_planilha',     'assistente'),
       ($1, $2, 'analise_edital',     'admin'),
       ($1, $2, 'adicionar_calendario','admin')`,
    [oportunidadeId, op.cliente_id],
  );

  // 2. Notificações
  await db.query(
    `INSERT INTO notificacoes (role_destino, oportunidade_id, tipo, titulo, mensagem)
     VALUES
       ('admin', $1, 'interesse_confirmado',
        $2, $3),
       ('diretor_comercial', $1, 'interesse_confirmado',
        $4, 'Oportunidade convertida. Acompanhe no pipeline.')`,
    [
      oportunidadeId,
      `Interesse confirmado — ${op.cliente_nome}`,
      `${op.cliente_nome} confirmou participação em ${op.orgao}. Valor: ${formatarMoeda(op.valor_estimado)}. Encerra: ${formatarData(op.data_encerramento)}. 3 tarefas pendentes: planilha, análise, calendário.`,
      `Cliente confirmou — ${op.cliente_nome}`,
    ],
  );

  // 3. Adicionar ao calendário
  try {
    await db.query(
      `INSERT INTO calendario_conlicit
         (tipo, titulo, data_evento, data_encerramento, plataforma, orgao,
          valor_estimado, oportunidade_id, cliente_id, visivel_para_roles)
       VALUES ('pregao', $1, $2, $2, $3, $4, $5, $6, $7,
               ARRAY['admin','socio_fundador','diretor_comercial'])`,
      [
        `${op.cliente_nome} — ${op.orgao}`,
        op.data_encerramento,
        op.plataforma,
        op.orgao,
        op.valor_estimado,
        oportunidadeId,
        op.cliente_id,
      ],
    );
  } catch (e) {
    console.error('[PosConfirmacao] Erro ao inserir calendário:', e.message);
  }

  // 4. WhatsApp à diretora
  const msgDiretora =
    `🎯 *Interesse confirmado!*\n\n` +
    `👤 Cliente: ${op.cliente_nome}\n` +
    `🏛️ Órgão: ${op.orgao || 'Não informado'}\n` +
    `💰 Valor: ${formatarMoeda(op.valor_estimado)}\n` +
    `📅 Encerra: ${formatarData(op.data_encerramento)}\n` +
    `🖥️ Plataforma: ${op.plataforma || 'Não informada'}\n\n` +
    `✅ Tarefas criadas no Hub:\n` +
    `📊 Gerar planilha de proposta\n` +
    `📋 Análise completa do edital\n` +
    `📆 Adicionado ao calendário\n\n` +
    `Acesse: ${HUB_URL}`;

  try {
    await zapiSvc.enviarTexto(DIRETORA_WPP, msgDiretora);
  } catch (e) {
    console.error('[PosConfirmacao] Erro Z-API (diretora):', e.message);
  }

  // 5. Email à diretora
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: 'Conlicit Hub <noreply@hub.conlicit.com>',
        to: DIRETORA_EMAIL,
        subject: `🎯 Interesse confirmado — ${op.cliente_nome} — ${op.orgao}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#182A39;padding:24px;border-radius:8px 8px 0 0">
              <h1 style="color:#4CC5D7;margin:0;font-size:22px">🎯 Interesse Confirmado</h1>
            </div>
            <div style="background:#f9f9f9;padding:24px;border:1px solid #e0e0e0">
              <p><strong>Cliente:</strong> ${op.cliente_nome}</p>
              <p><strong>Órgão:</strong> ${op.orgao || 'Não informado'}</p>
              <p><strong>Valor estimado:</strong> ${formatarMoeda(op.valor_estimado)}</p>
              <p><strong>Encerramento:</strong> ${formatarData(op.data_encerramento)}</p>
              <p><strong>Plataforma:</strong> ${op.plataforma || 'Não informada'}</p>
              <p><strong>Objeto:</strong> ${op.objeto || 'Não informado'}</p>
              <hr style="border:1px solid #e0e0e0;margin:16px 0">
              <p><strong>Tarefas criadas:</strong></p>
              <ul>
                <li>📊 Gerar planilha de proposta (Assistente)</li>
                <li>📋 Análise completa do edital (Diretora)</li>
                <li>📆 Adicionado ao calendário (Diretora)</li>
              </ul>
              <div style="text-align:center;margin-top:24px">
                <a href="${HUB_URL}/oportunidades/${oportunidadeId}"
                   style="background:#4CC5D7;color:#182A39;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold">
                  Abrir no Hub
                </a>
              </div>
            </div>
          </div>
        `,
      });
    }
  } catch (e) {
    console.error('[PosConfirmacao] Erro Resend:', e.message);
  }

  // 6. WhatsApp ao cliente confirmando
  if (op.cliente_wpp) {
    try {
      await zapiSvc.enviarTexto(
        op.cliente_wpp,
        `✅ Recebemos sua confirmação! Nossa equipe já está preparando tudo para o pregão. Em breve entramos em contato.`,
      );
    } catch (e) {
      console.error('[PosConfirmacao] Erro Z-API (cliente):', e.message);
    }
  }
}

module.exports = { processarConfirmacaoCliente };
