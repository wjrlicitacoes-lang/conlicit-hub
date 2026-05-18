const axios = require('axios');
const db = require('../database/db');

const PNCP_BASE_URL = process.env.PNCP_BASE_URL || 'https://pncp.gov.br/api/consulta/v1';

function semAcento(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function dataHoje() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function dataMais30() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function formatarMoeda(valor) {
  if (valor == null) return '—';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBR(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function limparTelefone(tel) {
  const d = tel.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) return d;
  return '55' + d;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary match on NFD-stripped text — avoids "racoes" matching inside "contratacoes"
function criarRegex(termo) {
  const normalizado = escapeRegex(semAcento(termo));
  return new RegExp(`\\b${normalizado}\\b`);
}

// Returns [{item, termosMatchados}] — one entry per unique edital
async function buscarEditaisParaCliente(cliente) {
  const dataInicial = dataHoje();
  const dataFinal = dataMais30();

  const PAGINAS = Array.from({ length: 20 }, (_, i) => i + 1);

  let pool;
  try {
    const paginas = await Promise.all(
      PAGINAS.map((p) =>
        axios.get(`${PNCP_BASE_URL}/contratacoes/proposta`, {
          params: { dataInicial, dataFinal, pagina: p, tamanhoPagina: 50 },
          timeout: 15000,
        }).then((r) => r.data.data ?? []).catch(() => []),
      ),
    );
    pool = paginas.flat();
  } catch (e) {
    console.error(`[Boletim] Erro buscando editais para ${cliente.email}:`, e.message);
    return [];
  }

  if (cliente.uf) {
    const ufUpper = cliente.uf.toUpperCase();
    pool = pool.filter((item) =>
      (item.unidadeOrgao?.ufSigla ?? '').toUpperCase() === ufUpper,
    );
  }

  const termos = (cliente.palavras_chave ?? []).filter(Boolean);
  const regexes = termos.map((t) => ({ original: t, re: criarRegex(t) }));

  const encontrados = new Map();

  for (const item of pool) {
    const objeto = semAcento(item.objetoCompra ?? '');
    const orgao  = semAcento(item.orgaoEntidade?.razaoSocial ?? '');

    const termosMatchados = regexes
      .filter(({ re }) => re.test(objeto) || re.test(orgao))
      .map(({ original }) => original);

    const bate = termos.length === 0 || termosMatchados.length > 0;
    if (bate && !encontrados.has(item.numeroControlePNCP)) {
      encontrados.set(item.numeroControlePNCP, { item, termosMatchados });
    }
  }

  return [...encontrados.values()];
}

// ── WhatsApp via Z-API ──
async function enviarWhatsApp(whatsapp, mensagem) {
  const instance = process.env.ZAPI_INSTANCE;
  const token = process.env.ZAPI_TOKEN;
  if (!instance || !token) throw new Error('ZAPI_INSTANCE/ZAPI_TOKEN não configurados');

  const telefone = limparTelefone(whatsapp);
  const { data } = await axios.post(
    `https://api.z-api.io/instances/${instance}/token/${token}/send-text`,
    { phone: telefone, message: mensagem },
    { timeout: 15000 },
  );
  return data;
}

// resultados = [{item, termosMatchados}]
function montarMensagemWhatsApp(nome, resultados) {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  let msg = `🔔 *Boletim ConlicitHub* — ${hoje}\n\n`;
  msg += `Olá, *${nome}*! Encontramos *${resultados.length}* edital(is) para você hoje.\n\n`;

  resultados.slice(0, 10).forEach(({ item: e, termosMatchados }, i) => {
    const obj = (e.objetoCompra || '—').slice(0, 120);
    const uf  = e.unidadeOrgao?.ufSigla || '—';
    const enc = formatarDataBR(e.dataEncerramentoProposta);
    const val = formatarMoeda(e.valorTotalEstimado);
    const { cnpj } = e.orgaoEntidade ?? {};
    const link = cnpj ? `https://pncp.gov.br/app/editais/${cnpj}/${e.anoCompra}/${e.sequencialCompra}` : '';

    msg += `*${i + 1}. ${e.orgaoEntidade?.razaoSocial || '—'}* (${uf})\n`;
    msg += `📋 ${obj}${obj.length >= 120 ? '…' : ''}\n`;
    msg += `💰 ${val} | ⏰ Encerra: ${enc}\n`;
    if (termosMatchados.length > 0) msg += `🏷️ _${termosMatchados.join(', ')}_\n`;
    if (link) msg += `🔗 ${link}\n`;
    msg += '\n';
  });

  msg += '_ConlicitHub — Editais Públicos do PNCP_';
  return msg;
}

// ── Email via Resend ──
// resultados = [{item, termosMatchados}]
async function enviarEmail(email, nome, resultados) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada');

  const from = process.env.BOLETIM_FROM_EMAIL || 'onboarding@resend.dev';
  const hoje = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const cards = resultados.slice(0, 10).map(({ item: e, termosMatchados }) => {
    const uf   = e.unidadeOrgao?.ufSigla || '';
    const mun  = e.unidadeOrgao?.municipioNome || '';
    const local = [mun, uf].filter(Boolean).join(' · ') || '—';
    const enc  = formatarDataBR(e.dataEncerramentoProposta);
    const val  = formatarMoeda(e.valorTotalEstimado);
    const { cnpj } = e.orgaoEntidade ?? {};
    const link = cnpj
      ? `https://pncp.gov.br/app/editais/${cnpj}/${e.anoCompra}/${e.sequencialCompra}`
      : '#';

    const badges = termosMatchados.length > 0
      ? termosMatchados.map((t) =>
          `<span style="display:inline-block;background:#0e2233;color:#4CC5D7;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;margin-right:4px;margin-bottom:4px;border:1px solid #4CC5D7;">${t}</span>`,
        ).join('')
      : '';

    return `
      <div style="background:#1a2f3e;border-radius:8px;padding:20px;margin-bottom:16px;border-left:3px solid #4CC5D7;">
        <div style="font-size:11px;color:#4CC5D7;font-weight:600;margin-bottom:6px;font-family:monospace;">${e.numeroControlePNCP || ''}</div>
        <div style="font-size:15px;font-weight:700;color:#e8f4f7;margin-bottom:6px;">${e.orgaoEntidade?.razaoSocial || '—'}</div>
        <div style="font-size:13px;color:#7fa8bb;margin-bottom:10px;line-height:1.5;">${(e.objetoCompra || '—').slice(0, 220)}${(e.objetoCompra || '').length > 220 ? '…' : ''}</div>
        ${badges ? `<div style="margin-bottom:12px;">${badges}</div>` : ''}
        <table style="border-collapse:collapse;margin-bottom:14px;font-size:12px;color:#b0d4de;">
          <tr>
            <td style="padding-right:20px;padding-bottom:4px;"><strong style="color:#4CC5D7;">Valor</strong><br>${val}</td>
            <td style="padding-right:20px;padding-bottom:4px;"><strong style="color:#4CC5D7;">Encerra</strong><br>${enc}</td>
            <td><strong style="color:#4CC5D7;">Local</strong><br>${local}</td>
          </tr>
        </table>
        <a href="${link}" style="display:inline-block;background:#4CC5D7;color:#182A39;font-weight:700;font-size:13px;padding:8px 18px;border-radius:6px;text-decoration:none;">Ver edital no PNCP →</a>
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#182A39;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="text-align:center;padding:24px 0 32px;">
      <span style="font-size:22px;font-weight:700;color:#e8f4f7;">Conlicit<span style="color:#4CC5D7;">Hub</span></span>
    </div>
    <div style="background:#1f3547;border-radius:12px;padding:28px;margin-bottom:24px;">
      <h1 style="font-size:20px;color:#e8f4f7;margin:0 0 6px;">🔔 Boletim de Editais</h1>
      <p style="font-size:13px;color:#7fa8bb;margin:0 0 14px;text-transform:capitalize;">${hoje}</p>
      <p style="font-size:14px;color:#b0d4de;margin:0;">Olá, <strong>${nome}</strong>! Encontramos <strong style="color:#4CC5D7;">${resultados.length} edital(is)</strong> com base nos seus interesses.</p>
    </div>
    ${cards}
    <div style="text-align:center;padding:24px 0;border-top:1px solid #243d50;margin-top:8px;">
      <p style="font-size:12px;color:#4a6a7f;margin:0;">ConlicitHub — Editais Públicos do PNCP</p>
    </div>
  </div>
</body></html>`;

  // Collect unique matched keywords across all editais for the subject line
  const todasKeywords = [...new Set(resultados.flatMap((r) => r.termosMatchados))];
  const dataFormatada = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const keywordsStr = todasKeywords.length > 0 ? `: ${todasKeywords.slice(0, 5).join(', ')}` : '';
  const subject = `🔔 Boletim ConlicitHub — ${resultados.length} edital(is)${keywordsStr} · ${dataFormatada}`;

  const { data } = await axios.post(
    'https://api.resend.com/emails',
    { from, to: email, subject, html },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 },
  );
  return data;
}

// ── Disparo principal ──
async function dispararBoletim() {
  const resultado = {
    inicio: new Date().toISOString(),
    clientes_processados: 0,
    clientes_com_editais: 0,
    envios_whatsapp: 0,
    envios_email: 0,
    erros: [],
  };

  const { rows: clientes } = await db.query(
    'SELECT * FROM clientes WHERE ativo = TRUE ORDER BY id',
  );

  console.log(`[Boletim] Iniciando disparo para ${clientes.length} cliente(s) ativo(s)`);

  for (const cliente of clientes) {
    resultado.clientes_processados++;
    try {
      const resultados = await buscarEditaisParaCliente(cliente);

      if (resultados.length === 0) {
        console.log(`[Boletim] Sem editais para ${cliente.email}`);
        continue;
      }

      resultado.clientes_com_editais++;
      const termosUnicos = [...new Set(resultados.flatMap((r) => r.termosMatchados))];
      console.log(`[Boletim] ${resultados.length} edital(is) para ${cliente.email} — termos: ${termosUnicos.join(', ') || 'todos'}`);

      if (cliente.whatsapp) {
        try {
          await enviarWhatsApp(cliente.whatsapp, montarMensagemWhatsApp(cliente.nome, resultados));
          resultado.envios_whatsapp++;
        } catch (e) {
          resultado.erros.push({ cliente: cliente.email, canal: 'whatsapp', erro: e.message });
        }
      }

      if (cliente.email) {
        try {
          await enviarEmail(cliente.email, cliente.nome, resultados);
          resultado.envios_email++;
        } catch (e) {
          resultado.erros.push({ cliente: cliente.email, canal: 'email', erro: e.message });
        }
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      console.error(`[Boletim] Erro processando ${cliente.email}:`, e.message);
      resultado.erros.push({ cliente: cliente.email, erro: e.message });
    }
  }

  resultado.fim = new Date().toISOString();
  console.log('[Boletim] Concluído:', JSON.stringify(resultado));
  return resultado;
}

module.exports = { dispararBoletim };
