'use strict';
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const db    = require('../database/db');
const { enviarTexto }  = require('../services/zapiService');
const { enviarEmail }  = require('../services/emailService');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const CONLICIT_EMAIL     = 'wjrlicitacoes@gmail.com';
const CONLICIT_WHATSAPP  = '5531982388210';

// ─────────────────────────────────────────────────────────────
// POST /api/boletim/triar
// ─────────────────────────────────────────────────────────────
async function triar(req, res) {
  const { cliente_nome, cliente_nicho, editais } = req.body;
  if (!editais?.length) return res.status(400).json({ erro: 'Nenhum edital recebido' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'ANTHROPIC_API_KEY não configurada' });

  const listaFormatada = editais.map((e, i) =>
    `${i + 1}. Título: ${e.titulo || '—'} | Órgão: ${e.orgao || '—'} | UF: ${e.uf || '—'} | ` +
    `Valor: ${e.valor || '—'} | Prazo: ${e.prazo || '—'} | Modalidade: ${e.modalidade || '—'} | ` +
    `Objeto: ${e.objeto || '—'}`
  ).join('\n');

  const userMsg =
    `Cliente: ${cliente_nome || 'não informado'}\nNicho: ${cliente_nicho || 'não informado'}\n\n` +
    `Editais:\n${listaFormatada}`;

  try {
    const { data } = await axios.post(
      ANTHROPIC_URL,
      {
        model:      process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5',
        max_tokens: 400,
        system: 'Você é o Edson, assistente de triagem de licitações da Conlicit. ' +
                'Analise os editais abaixo para o perfil do cliente e retorne APENAS um array JSON, ' +
                'sem texto fora do JSON: ' +
                '[{"score":1-10,"justificativa":"string curta","recomendacao":"Participar"|"Avaliar"|"Dispensar"}]',
        messages: [{ role: 'user', content: userMsg }],
      },
      {
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type':      'application/json',
        },
        timeout: 30000,
      },
    );

    const raw = data.content?.[0]?.text || '[]';
    let triagem;
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      triagem = match ? JSON.parse(match[0]) : [];
    } catch {
      triagem = [];
    }

    // Garante mesmo comprimento que input
    while (triagem.length < editais.length) {
      triagem.push({ score: 5, justificativa: 'Análise indisponível', recomendacao: 'Avaliar' });
    }

    return res.json({ triagem: triagem.slice(0, editais.length) });
  } catch (err) {
    console.error('[Boletim] triar:', err.response?.data || err.message);
    return res.status(500).json({ erro: 'Erro ao triar com Edson: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/boletim/gerar-html
// ─────────────────────────────────────────────────────────────
async function gerarHtml(req, res) {
  const { cliente_id, cliente_nome, semana, editais_triados } = req.body;
  if (!cliente_nome || !semana) return res.status(400).json({ erro: 'cliente_nome e semana obrigatórios' });

  const nomeArquivo   = `boletim-${cliente_id || 'novo'}-semana${semana.replace('/', '-')}.html`;
  const caminhoArquivo = path.join(__dirname, '../../public/boletins', nomeArquivo);
  const urlBoletim    = `/boletins/${nomeArquivo}`;

  const dataGeracao = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  function scoreClass(s) {
    if (s >= 8) return '#4CC5D7';
    if (s >= 7) return '#22c55e';
    if (s >= 5) return '#f59e0b';
    return '#ef4444';
  }

  function badgeHTML(rec, titulo, valor, prazo, orgao) {
    if (rec === 'Participar') {
      const t = (titulo || '').replace(/'/g, "\\'");
      const v = (valor  || '').replace(/'/g, "\\'");
      const p = (prazo  || '').replace(/'/g, "\\'");
      const o = (orgao  || '').replace(/'/g, "\\'");
      return `<button onclick="alertarOportunidade('${t}','${v}','${p}','${o}')"
        style="background:#4CC5D7;color:#fff;border:none;padding:6px 14px;border-radius:20px;
               font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.5px">
        ✅ PARTICIPAR
      </button>`;
    }
    if (rec === 'Avaliar') {
      return `<span style="background:#fef3c7;color:#92400e;padding:5px 12px;border-radius:20px;
                            font-size:12px;font-weight:700">⚠️ AVALIAR</span>`;
    }
    return `<span style="background:#fee2e2;color:#991b1b;padding:5px 12px;border-radius:20px;
                          font-size:12px;font-weight:700">❌ DISPENSAR</span>`;
  }

  const cardsHTML = (editais_triados || []).map(e => `
    <div style="background:#fff;border:1px solid #E2EAF0;border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="font-size:14px;font-weight:700;color:#182A39;margin-bottom:6px;line-height:1.4">
            ${e.titulo || '—'}
          </div>
          <div style="font-size:12px;color:#64748b;margin-bottom:10px">
            🏛 ${e.orgao || '—'} · 📍 ${e.uf || '—'}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            ${e.valor  ? `<span style="background:#f0f4f6;color:#475569;padding:3px 10px;border-radius:20px;font-size:11px">💰 ${e.valor}</span>` : ''}
            ${e.prazo  ? `<span style="background:#f0f4f6;color:#475569;padding:3px 10px;border-radius:20px;font-size:11px">📅 Prazo: ${e.prazo}</span>` : ''}
          </div>
          ${e.justificativa ? `<div style="font-size:12px;color:#475569;border-left:3px solid #4CC5D7;padding-left:10px;font-style:italic">${e.justificativa}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;min-width:90px">
          <div style="width:52px;height:52px;border-radius:50%;background:${scoreClass(e.score || 0)};
                      display:flex;align-items:center;justify-content:center;
                      font-size:18px;font-weight:800;color:#fff">
            ${e.score || 0}
          </div>
          <div style="font-size:10px;color:#94a3b8;font-weight:600">SCORE</div>
          ${badgeHTML(e.recomendacao, e.titulo, e.valor, e.prazo, e.orgao)}
        </div>
      </div>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Boletim de Licitações — ${cliente_nome} — Semana ${semana}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; background: #F0F4F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .container { max-width: 700px; margin: 0 auto; }
    @media (max-width: 600px) { body { padding: 10px; } }
  </style>
</head>
<body>
  <div class="container">

    <!-- Header -->
    <div style="background:#182A39;border-radius:12px;padding:28px 32px;margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <img src="/assets/images/logo-branca.png" style="height:36px" alt="Conlicit">
        <div style="text-align:right">
          <div style="color:#4CC5D7;font-size:13px;font-weight:700;letter-spacing:.5px">BOLETIM DE LICITAÇÕES</div>
          <div style="color:#94a3b8;font-size:11px;margin-top:2px">Semana ${semana} · ${dataGeracao}</div>
        </div>
      </div>
      <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1)">
        <div style="color:#fff;font-size:18px;font-weight:700">${cliente_nome}</div>
        <div style="color:#94a3b8;font-size:13px;margin-top:4px">
          ${editais_triados?.length || 0} edital(is) triado(s) · ${(editais_triados || []).filter(e => e.recomendacao === 'Participar').length} recomendado(s) para participar
        </div>
      </div>
    </div>

    <!-- Editais -->
    ${cardsHTML || '<p style="color:#64748b;text-align:center;padding:40px 0">Nenhum edital neste boletim.</p>'}

    <!-- Rodapé -->
    <div style="text-align:center;padding:24px 0;color:#94a3b8;font-size:12px;border-top:1px solid #E2EAF0;margin-top:8px">
      conlicit · Consultoria em Licitações Públicas
    </div>

  </div>

  <script>
    var CONLICIT_EMAIL     = "${CONLICIT_EMAIL}";
    var CONLICIT_WHATSAPP  = "${CONLICIT_WHATSAPP}";

    function alertarOportunidade(titulo, valor, prazo, orgao) {
      var assunto = encodeURIComponent('Interesse em Licitação — ' + titulo);
      var corpo   = encodeURIComponent(
        'Olá,\\n\\nTenho interesse na seguinte licitação:\\n\\n' +
        'Título: ' + titulo + '\\nÓrgão: ' + orgao + '\\nValor: ' + valor + '\\nPrazo: ' + prazo +
        '\\n\\nPor favor, entre em contato.'
      );
      window.location.href = 'mailto:' + CONLICIT_EMAIL + '?subject=' + assunto + '&body=' + corpo;

      setTimeout(function() {
        var msg = encodeURIComponent(
          '🏆 Olá! Tenho interesse na licitação:\\n' +
          '📋 ' + titulo + '\\n' +
          '🏛 ' + orgao + '\\n' +
          '💰 ' + valor + '\\n' +
          '📅 Prazo: ' + prazo
        );
        window.open('https://wa.me/' + CONLICIT_WHATSAPP + '?text=' + msg, '_blank');
      }, 800);
    }
  </script>
</body>
</html>`;

  try {
    fs.mkdirSync(path.dirname(caminhoArquivo), { recursive: true });
    fs.writeFileSync(caminhoArquivo, html, 'utf8');
    return res.json({ url: urlBoletim, html });
  } catch (err) {
    console.error('[Boletim] gerarHtml:', err.message);
    return res.status(500).json({ erro: 'Erro ao gerar HTML: ' + err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/boletim/disparar
// ─────────────────────────────────────────────────────────────
async function disparar(req, res) {
  const { cliente_id, cliente_nome, cliente_email, cliente_whatsapp, url_boletim, mensagem_whatsapp, semana, canal, editais_triados } = req.body;

  const appUrl    = process.env.APP_URL || 'https://web-production-18d79.up.railway.app';
  const linkFull  = url_boletim?.startsWith('http') ? url_boletim : `${appUrl}${url_boletim}`;
  const resultados = [];
  const erros      = [];

  // WhatsApp
  if (canal === 'whatsapp' || canal === 'ambos') {
    const destWpp = cliente_whatsapp || CONLICIT_WHATSAPP;
    const msgFinal = (mensagem_whatsapp || `📋 *Boletim de Licitações — Semana ${semana}*\n\nOlá, ${cliente_nome}!\n\nSeu boletim semanal está pronto. Acesse: ${linkFull}`);
    try {
      await enviarTexto(destWpp, msgFinal);
      resultados.push('whatsapp');
    } catch (e) {
      console.error('[Boletim] disparar whatsapp:', e.message);
      erros.push('whatsapp: ' + e.message);
    }
  }

  // Email
  if (canal === 'email' || canal === 'ambos') {
    if (!cliente_email) {
      erros.push('email: cliente sem e-mail cadastrado');
    } else {
      try {
        await enviarEmail({
          destinatarioEmail: cliente_email,
          destinatarioNome:  cliente_nome,
          assunto:           `📋 Boletim de Licitações — Semana ${semana} — Conlicit`,
          corpoHtml: `<p>Olá, <strong>${cliente_nome}</strong>!</p>
            <p>Seu boletim semanal de licitações da semana ${semana} está disponível.</p>
            <p><a href="${linkFull}" style="background:#4CC5D7;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block">
              Acessar boletim →
            </a></p>
            <p style="color:#64748b;font-size:12px;margin-top:20px">conlicit · Consultoria em Licitações Públicas</p>`,
        });
        resultados.push('email');
      } catch (e) {
        console.error('[Boletim] disparar email:', e.message);
        erros.push('email: ' + e.message);
      }
    }
  }

  // Registrar no banco
  try {
    const { rows } = await db.query(
      `INSERT INTO boletins (cliente_id, cliente_nome, semana, editais_json, html_url, disparado_em, canal)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6) RETURNING id`,
      [cliente_id || null, cliente_nome, semana, JSON.stringify(editais_triados || []), url_boletim, canal],
    );
    const boletimId = rows[0]?.id;

    if (boletimId && Array.isArray(editais_triados)) {
      for (const item of editais_triados) {
        await db.query(
          `INSERT INTO boletins_items (boletim_id, titulo, orgao, uf, valor, prazo, score, justificativa, recomendacao)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [boletimId, item.titulo, item.orgao, item.uf, item.valor, item.prazo,
           item.score, item.justificativa, item.recomendacao],
        ).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[Boletim] registrar banco:', e.message);
  }

  if (resultados.length === 0 && erros.length > 0) {
    return res.status(500).json({ erro: 'Falha no disparo', detalhes: erros });
  }

  return res.json({ sucesso: true, canais_enviados: resultados, erros });
}

module.exports = { triar, gerarHtml, disparar };
