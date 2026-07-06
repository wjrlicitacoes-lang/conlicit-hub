const express    = require('express');
const axios      = require('axios');
const autenticar = require('../middleware/autenticar');
const pncpAgent  = require('../lib/pncpAgent');
const db         = require('../database/db');

const router = express.Router();
router.use(autenticar);

const PNCP_BASE = 'https://pncp.gov.br/api/pncp/v1';

const PALAVRAS_CRITICAS = [
  'CONVOCADO','CONVOCO','ENCERRA','ENCERRANDO','DOCUMENTOS',
  'HABILITAÇÃO','HABILITADO','DESCLASSIFICADO','SUSPENS',
  'NEGOCIAR','VENCEDOR','ADJUDICADO',
];

const PALAVRAS_VITORIA = ['VENCEDOR', 'ADJUDICADO'];

async function criarTarefaPosVitoria(numero_pregao, pregao_id) {
  try {
    const { rows } = await db.query(
      `SELECT id FROM usuarios WHERE email = 'werbert@conlicit.com' LIMIT 1`,
    );
    const responsavel_id = rows[0]?.id || null;
    const data_prazo = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    await db.query(`
      INSERT INTO tarefas
        (titulo, descricao, status, prioridade, responsavel_id, categoria, pregao_id, data_prazo)
      VALUES ($1,$2,'a_fazer','urgente',$3,'pos_pregao',$4,$5)
      ON CONFLICT DO NOTHING
    `, [
      `Pós-vitória — Pregão ${numero_pregao || pregao_id || '?'}`,
      'Adjudicação detectada. Executar SOP 01: proposta readequada + catálogo + contrato.',
      responsavel_id,
      pregao_id || null,
      data_prazo,
    ]);
    console.log('[tarefas] tarefa pós-vitória criada para pregão', numero_pregao);
  } catch (e) {
    console.error('[tarefas] erro ao criar tarefa pós-vitória:', e.message);
  }
}

// Controle de duplicatas em memória (por processo)
const alertasEnviados = new Set();

async function alertarWhatsApp(numero, mensagem) {
  const inst  = process.env.ZAPI_INSTANCE;
  const token = process.env.ZAPI_TOKEN;
  if (!inst || !token || !numero) return;
  try {
    const url = `https://api.z-api.io/instances/${inst}/token/${token}/send-text`;
    const resp = await axios.post(url, { phone: numero, message: mensagem });
    console.log('[zapi] alerta enviado:', resp.data);
  } catch (err) {
    console.error('[zapi] falha ao enviar alerta:', err.message);
  }
}

// POST /api/monitor/chat
// Body: { pregao_id, cnpj_orgao, ano, sequencial, numero_pregao?, orgao? }
router.post('/chat', async (req, res) => {
  const { pregao_id, cnpj_orgao, ano, sequencial, numero_pregao, orgao } = req.body ?? {};
  console.log('[monitor] buscando chat para:', pregao_id);

  if (!cnpj_orgao || !ano || !sequencial) {
    return res.status(400).json({ erro: 'cnpj_orgao, ano e sequencial são obrigatórios' });
  }

  const cnpjLimpo = String(cnpj_orgao).replace(/\D/g, '');
  const seq       = String(sequencial).padStart(8, '0');
  const url       = `${PNCP_BASE}/orgaos/${cnpjLimpo}/compras/${ano}/${seq}/mensagens`;

  let mensagens = [];
  try {
    const resp = await axios.get(url, { httpsAgent: pncpAgent, timeout: 12000 });
    const data = resp.data;
    mensagens = Array.isArray(data) ? data : (data?.mensagens ?? data?.data ?? []);

    if (!mensagens.length) {
      console.log('[monitor] resposta vazia do PNCP');
    }
  } catch (err) {
    console.error('[monitor] erro ao buscar PNCP:', err.message, 'url:', url);
    return res.json({ mensagens: [], erro: err.message });
  }

  // Detectar palavras críticas e disparar alertas
  const palavrasDetectadas = [];
  for (const msg of mensagens) {
    const texto = (msg.mensagem || msg.texto || msg.conteudo || '').toUpperCase();
    for (const palavra of PALAVRAS_CRITICAS) {
      if (!texto.includes(palavra)) continue;
      const chave = `${pregao_id || cnpjLimpo}::${palavra}`;
      if (alertasEnviados.has(chave)) continue;
      alertasEnviados.add(chave);
      palavrasDetectadas.push({ palavra, msg });

      const numero = process.env.WERBERT_WHATSAPP;
      if (numero) {
        const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const alerta = `🚨 *CONLICIT HUB — ALERTA DE PREGÃO*\n\nPalavra detectada: *${palavra}*\nPregão: ${numero_pregao || pregao_id || '—'}\nÓrgão: ${orgao || '—'}\nHorário: ${hora}\n\nAcesse: hub.conlicit.com`;
        await alertarWhatsApp(numero, alerta);
      }

      if (PALAVRAS_VITORIA.includes(palavra)) {
        criarTarefaPosVitoria(numero_pregao, pregao_id);
      }
    }
  }

  return res.json({ mensagens, palavrasDetectadas });
});

module.exports = router;
