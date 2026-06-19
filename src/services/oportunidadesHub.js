const axios   = require('axios');
const db      = require('../database/db');
const zapiSvc = require('./zapiService');
const { getMunicipiosNoRaio } = require('./municipios');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function formatarMoeda(valor) {
  if (!valor) return 'Não informado';
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(data) {
  if (!data) return 'Não informada';
  const d = new Date(data);
  return d.toLocaleDateString('pt-BR');
}

async function gerarItensMatchIA(objeto, keywords, itens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return '';
  try {
    const model = process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5';
    const resp = await axios.post(
      ANTHROPIC_URL,
      {
        model,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Você é um assistente de licitações. Com base no objeto abaixo e nas palavras-chave do cliente, escreva em 2-3 linhas quais itens do edital são relevantes para esse cliente. Seja direto e objetivo. Sem introdução.\nObjeto: ${objeto}\nPalavras-chave do cliente: ${keywords}\nItens do edital: ${itens || 'Não informado'}`,
        }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 20000,
      },
    );
    return resp.data?.content?.[0]?.text || '';
  } catch (e) {
    console.error('[OportunidadesHub] Erro IA:', e.message);
    return '';
  }
}

async function enviarWhatsAppOportunidade(whatsapp, dados) {
  const msg =
    `🔔 *Nova Oportunidade de Licitação*\n\n` +
    `📋 *Objeto:* ${dados.objeto?.slice(0, 100) || 'Não informado'}\n` +
    `🏛️ *Órgão:* ${dados.orgao || 'Não informado'}\n` +
    `💰 *Valor estimado:* ${formatarMoeda(dados.valor_estimado)}\n` +
    `📅 *Encerramento:* ${formatarData(dados.data_encerramento)}\n` +
    `🖥️ *Plataforma:* ${dados.plataforma || 'Não informada'}\n\n` +
    `*Itens relacionados ao seu negócio:*\n${(dados.itens_match || []).map(i => `• ${i}`).join('\n') || dados.itens_match_texto || ''}\n\n` +
    `🔗 ${dados.url_edital || ''}\n\n` +
    `Você tem interesse nessa oportunidade?\nResponda *SIM* ou *NÃO*`;

  try {
    await zapiSvc.enviarTexto(whatsapp, msg);
  } catch (e) {
    console.error('[OportunidadesHub] Erro Z-API (oportunidade):', e.message);
  }
}

async function enviarAlertaUrgente(whatsapp, dados) {
  const encerra = new Date(dados.data_encerramento);
  const diasRestantes = Math.ceil((encerra - new Date()) / 86400000);
  const msg =
    `⚠️ *ATENÇÃO: Licitação encerrando em breve!*\n\n` +
    `📋 ${dados.objeto?.slice(0, 80) || 'Não informado'}\n` +
    `📅 *Encerra:* ${formatarData(dados.data_encerramento)} (${diasRestantes} dias)\n` +
    `💰 ${formatarMoeda(dados.valor_estimado)}\n` +
    `🖥️ ${dados.plataforma || 'Não informada'}\n\n` +
    `🔗 ${dados.url_edital || ''}\n\n` +
    `Ainda tem interesse? Responda *SIM* ou *NÃO*`;

  try {
    await zapiSvc.enviarTexto(whatsapp, msg);
  } catch (e) {
    console.error('[OportunidadesHub] Erro Z-API (alerta urgente):', e.message);
  }
}

async function processarOportunidadesParaCliente(cliente) {
  const stats = { processados: 0, enviados: 0, alertas_urgentes: 0, erros: 0 };

  if (!cliente.municipio_base) {
    console.log(`[OportunidadesHub] Cliente ${cliente.nome} sem municipio_base — pulando`);
    return stats;
  }

  let municipios;
  try {
    municipios = await getMunicipiosNoRaio(
      cliente.municipio_base,
      cliente.uf_base || 'MG',
      cliente.raio_km || 100,
    );
  } catch (e) {
    console.error(`[OportunidadesHub] Erro geolocalização ${cliente.nome}:`, e.message);
    return stats;
  }

  const nomesMunicipios = municipios.map(m => m.nome.toLowerCase());
  const keywords = (cliente.keywords || cliente.palavras_chave || '').split(/[,;\n]+/).map(k => k.trim()).filter(Boolean);

  if (!keywords.length) {
    console.log(`[OportunidadesHub] Cliente ${cliente.nome} sem keywords — pulando`);
    return stats;
  }

  const editaisEncontrados = new Map();

  for (const keyword of keywords) {
    try {
      const { rows } = await db.query(
        `SELECT * FROM editais_cache
         WHERE to_tsvector('portuguese', coalesce(objeto,'') || ' ' || coalesce(orgao_nome,''))
               @@ plainto_tsquery('portuguese', $1)
           AND LOWER(municipio) = ANY($2::text[])
           AND data_encerramento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '15 days'`,
        [keyword, nomesMunicipios],
      );
      for (const e of rows) {
        if (!editaisEncontrados.has(e.numero_controle_pncp)) {
          editaisEncontrados.set(e.numero_controle_pncp, e);
        }
      }
    } catch (e) {
      console.error(`[OportunidadesHub] Erro busca keyword "${keyword}" para ${cliente.nome}:`, e.message);
      stats.erros++;
    }
  }

  for (const edital of editaisEncontrados.values()) {
    stats.processados++;
    try {
      const { rows: existing } = await db.query(
        `SELECT * FROM oportunidades
         WHERE cliente_id = $1 AND numero_edital = $2`,
        [cliente.id, edital.numero_controle_pncp],
      );

      if (existing.length > 0) {
        const op = existing[0];
        const encerra = new Date(edital.data_encerramento || op.data_encerramento);
        const tresDisasDepois = new Date(Date.now() + 3 * 86400000);
        const estaUrgente = encerra <= tresDisasDepois;
        const naoEnviouAlerta = op.status !== 'alerta_urgente_enviado';
        const aguardando = op.status === 'aguardando_resposta';

        if (aguardando && estaUrgente && naoEnviouAlerta) {
          const whatsapp = cliente.whatsapp || cliente.contato_whatsapp;
          if (whatsapp) {
            await enviarAlertaUrgente(whatsapp, { ...edital, ...op });
          }
          await db.query(
            `UPDATE oportunidades SET status = 'alerta_urgente_enviado' WHERE id = $1`,
            [op.id],
          );
          stats.alertas_urgentes++;
        }
        continue;
      }

      const itensMatch = await gerarItensMatchIA(
        edital.objeto,
        keywords.join(', '),
        edital.itens_texto || '',
      );

      const itensArray = itensMatch
        ? itensMatch.split('\n').filter(l => l.trim()).map(l => l.replace(/^[-•]\s*/, ''))
        : [];

      await db.query(
        `INSERT INTO oportunidades
           (cliente_id, numero_edital, orgao, objeto, valor_estimado,
            data_encerramento, plataforma, itens_match, url_edital, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'aguardando_resposta')`,
        [
          cliente.id,
          edital.numero_controle_pncp,
          edital.orgao_nome || edital.orgao,
          edital.objeto,
          edital.valor_estimado,
          edital.data_encerramento,
          edital.modalidade_nome || edital.plataforma || null,
          itensArray,
          `https://pncp.gov.br/app/editais/${edital.numero_controle_pncp}`,
        ],
      );

      const whatsapp = cliente.whatsapp || cliente.contato_whatsapp;
      if (whatsapp) {
        await enviarWhatsAppOportunidade(whatsapp, {
          objeto:           edital.objeto,
          orgao:            edital.orgao_nome,
          valor_estimado:   edital.valor_estimado,
          data_encerramento:edital.data_encerramento,
          plataforma:       edital.modalidade_nome,
          url_edital:       `https://pncp.gov.br/app/editais/${edital.numero_controle_pncp}`,
          itens_match:      itensArray,
          itens_match_texto: itensMatch,
        });
      }
      stats.enviados++;
    } catch (e) {
      console.error(`[OportunidadesHub] Erro edital ${edital.numero_controle_pncp} / cliente ${cliente.nome}:`, e.message);
      stats.erros++;
    }
  }
  return stats;
}

module.exports = { processarOportunidadesParaCliente };
