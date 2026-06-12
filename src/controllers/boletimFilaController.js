'use strict';
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const db    = require('../database/db');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CONLICIT_EMAIL    = 'wjrlicitacoes@gmail.com';
const CONLICIT_WHATSAPP = '5531982388210';

// GET /api/boletim/fila
async function listarFila(req, res) {
  const { cliente_id, status = 'na_fila' } = req.query;
  const conds  = ['bf.status = $1'];
  const params = [status];
  if (cliente_id) { conds.push(`bf.cliente_id = $${params.length + 1}`); params.push(parseInt(cliente_id, 10)); }

  try {
    const { rows } = await db.query(
      `SELECT bf.*, c.nome AS cliente_nome
       FROM boletim_fila bf
       LEFT JOIN clientes c ON c.id = bf.cliente_id
       WHERE ${conds.join(' AND ')}
       ORDER BY bf.adicionado_em DESC`,
      params,
    );
    return res.json({ itens: rows });
  } catch (err) {
    console.error('[BoletimFila] listarFila:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// POST /api/boletim/fila
async function adicionarFila(req, res) {
  const { pncp_id, titulo, orgao, uf, valor, prazo, modalidade, objeto, link_pncp, cliente_id } = req.body;
  if (!titulo) return res.status(400).json({ erro: 'titulo obrigatório' });

  try {
    if (pncp_id) {
      const dup = await db.query(
        `SELECT id FROM boletim_fila WHERE pncp_id = $1 AND status != 'descartado'`,
        [pncp_id],
      );
      if (dup.rows.length > 0) return res.status(409).json({ erro: 'Edital já está na fila', id: dup.rows[0].id });
    }

    const { rows } = await db.query(
      `INSERT INTO boletim_fila (pncp_id, titulo, orgao, uf, valor, prazo, modalidade, objeto, link_pncp, cliente_id, adicionado_por)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11) RETURNING *`,
      [pncp_id || null, titulo, orgao || null, uf || null, valor || null,
       prazo || null, modalidade || null, objeto || null, link_pncp || null,
       cliente_id ? parseInt(cliente_id, 10) : null, req.usuario?.id || null],
    );
    return res.status(201).json({ item: rows[0] });
  } catch (err) {
    console.error('[BoletimFila] adicionarFila:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// PATCH /api/boletim/fila/:id/cliente
async function atualizarCliente(req, res) {
  const { id } = req.params;
  const { cliente_id } = req.body;
  try {
    await db.query(
      `UPDATE boletim_fila SET cliente_id=$1 WHERE id=$2`,
      [cliente_id ? parseInt(cliente_id, 10) : null, parseInt(id, 10)],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[BoletimFila] atualizarCliente:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// DELETE /api/boletim/fila/:id
async function descartarFila(req, res) {
  const { id } = req.params;
  try {
    await db.query(`UPDATE boletim_fila SET status='descartado' WHERE id=$1`, [parseInt(id, 10)]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[BoletimFila] descartarFila:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// POST /api/boletim/fila/gerar
async function gerarBoletimDaFila(req, res) {
  const { cliente_id, semana } = req.body;
  if (!cliente_id || !semana) return res.status(400).json({ erro: 'cliente_id e semana obrigatórios' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'ANTHROPIC_API_KEY não configurada' });

  try {
    const filaRes = await db.query(
      `SELECT bf.*, c.nome AS cliente_nome,
              COALESCE(c.palavras_chave::text, '[]') AS nicho_json
       FROM boletim_fila bf
       LEFT JOIN clientes c ON c.id = bf.cliente_id
       WHERE bf.cliente_id = $1 AND bf.status = 'na_fila'
       ORDER BY bf.adicionado_em ASC`,
      [parseInt(cliente_id, 10)],
    );
    const itens = filaRes.rows;
    if (!itens.length) return res.status(400).json({ erro: 'Nenhum edital na fila para este cliente' });

    const clienteNome = itens[0].cliente_nome || `Cliente ${cliente_id}`;
    let nichoKws = [];
    try { nichoKws = JSON.parse(itens[0].nicho_json || '[]'); } catch { nichoKws = []; }
    const clienteNicho = nichoKws.join(', ');

    // Triagem Edson
    const listaFormatada = itens.map((e, i) =>
      `${i + 1}. Título: ${e.titulo || '—'} | Órgão: ${e.orgao || '—'} | UF: ${e.uf || '—'} | ` +
      `Valor: ${e.valor || '—'} | Modalidade: ${e.modalidade || '—'} | Objeto: ${e.objeto || '—'}`
    ).join('\n');

    let triagem = [];
    try {
      const { data } = await axios.post(
        ANTHROPIC_URL,
        {
          model:      process.env.CLAUDE_MODEL_EDSON || 'claude-haiku-4-5',
          max_tokens: 800,
          system: 'Você é o Edson, assistente de triagem de licitações da Conlicit. ' +
                  'Analise os editais abaixo para o perfil do cliente e retorne APENAS um array JSON, ' +
                  'sem texto fora do JSON: ' +
                  '[{"score":1-10,"justificativa":"string curta","recomendacao":"Participar"|"Avaliar"|"Dispensar"}]',
          messages: [{ role: 'user', content:
            `Cliente: ${clienteNome}\nNicho: ${clienteNicho || 'não informado'}\n\nEditais:\n${listaFormatada}` }],
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
      const raw   = data.content?.[0]?.text || '[]';
      const match = raw.match(/\[[\s\S]*\]/);
      triagem = match ? JSON.parse(match[0]) : [];
    } catch (e) {
      console.error('[BoletimFila] triagem Edson:', e.message);
    }
    while (triagem.length < itens.length) {
      triagem.push({ score: 5, justificativa: 'Análise indisponível', recomendacao: 'Avaliar' });
    }

    const editais_triados = itens.map((e, i) => ({
      titulo:        e.titulo,
      orgao:         e.orgao,
      uf:            e.uf,
      valor:         e.valor,
      prazo:         e.prazo
        ? new Date(e.prazo).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : '',
      modalidade:    e.modalidade,
      objeto:        e.objeto,
      pncp_id:       e.pncp_id,
      fila_id:       e.id,
      score:         triagem[i]?.score        || 5,
      justificativa: triagem[i]?.justificativa || '',
      recomendacao:  triagem[i]?.recomendacao  || 'Avaliar',
    }));

    // Gerar HTML
    const appUrl         = process.env.APP_URL || 'https://web-production-18d79.up.railway.app';
    const nomeArquivo    = `boletim-${cliente_id}-semana${semana.replace('/', '-')}.html`;
    const caminhoArquivo = path.join(__dirname, '../../public/boletins', nomeArquivo);
    const urlBoletim     = `/boletins/${nomeArquivo}`;
    const dataGeracao    = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    fs.mkdirSync(path.dirname(caminhoArquivo), { recursive: true });
    fs.writeFileSync(
      caminhoArquivo,
      _buildHTML({ clienteNome, semana, dataGeracao, editais_triados, appUrl }),
      'utf8',
    );

    // Registrar boletim
    const { rows: bRows } = await db.query(
      `INSERT INTO boletins (cliente_id, cliente_nome, semana, editais_json, html_url, html_gerado_em, total_editais, criado_por)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7) RETURNING id`,
      [parseInt(cliente_id, 10), clienteNome, semana, JSON.stringify(editais_triados),
       urlBoletim, itens.length, req.usuario?.id || null],
    );
    const boletimId = bRows[0]?.id;

    if (boletimId) {
      for (const e of editais_triados) {
        const { rows: biRows } = await db.query(
          `INSERT INTO boletins_items (boletim_id, titulo, orgao, uf, valor, prazo, score, justificativa, recomendacao, fila_id, pncp_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [boletimId, e.titulo, e.orgao, e.uf, e.valor, e.prazo,
           e.score, e.justificativa, e.recomendacao, e.fila_id || null, e.pncp_id || null],
        ).catch(() => ({ rows: [] }));

        if (e.fila_id) {
          await db.query(
            `UPDATE boletim_fila SET status='incluido_boletim', boletim_id=$1 WHERE id=$2`,
            [boletimId, e.fila_id],
          ).catch(() => {});
        }
      }
    }

    return res.json({ boletim_id: boletimId, url: urlBoletim, cliente_nome: clienteNome, semana, editais_triados });
  } catch (err) {
    console.error('[BoletimFila] gerarBoletimDaFila:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// POST /api/boletim/interesse  (PUBLIC — chamado por HTML externo)
async function registrarInteresse(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { boletim_id, boletim_item_id, cliente_id, titulo, orgao, uf, valor, prazo } = req.body;
  try {
    await db.query(
      `INSERT INTO boletins_interesses (boletim_id, boletim_item_id, cliente_id, titulo, orgao, uf, valor, prazo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [boletim_id    ? parseInt(boletim_id, 10)      : null,
       boletim_item_id ? parseInt(boletim_item_id, 10) : null,
       cliente_id    ? parseInt(cliente_id, 10)      : null,
       titulo || null, orgao || null, uf || null, valor || null, prazo || null],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[BoletimFila] registrarInteresse:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// GET /api/boletim/interesses/:cliente_id
async function listarInteressesCliente(req, res) {
  const { cliente_id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT bi.*, b.semana, b.html_url
       FROM boletins_interesses bi
       LEFT JOIN boletins b ON b.id = bi.boletim_id
       WHERE bi.cliente_id = $1
       ORDER BY bi.registrado_em DESC`,
      [parseInt(cliente_id, 10)],
    );
    return res.json({ interesses: rows });
  } catch (err) {
    console.error('[BoletimFila] listarInteressesCliente:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// PATCH /api/boletim/interesses/:id
async function atualizarInteresse(req, res) {
  const { id } = req.params;
  const { status, observacao } = req.body;
  try {
    await db.query(
      `UPDATE boletins_interesses
       SET status     = COALESCE($1, status),
           observacao = COALESCE($2, observacao)
       WHERE id = $3`,
      [status || null, observacao !== undefined ? observacao : null, parseInt(id, 10)],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[BoletimFila] atualizarInteresse:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// POST /api/boletim/interesses/:id/pregao
async function converterPregao(req, res) {
  const { id } = req.params;
  try {
    const intRes = await db.query(`SELECT * FROM boletins_interesses WHERE id=$1`, [parseInt(id, 10)]);
    if (!intRes.rows.length) return res.status(404).json({ erro: 'Interesse não encontrado' });
    const interesse = intRes.rows[0];

    const { rows: pgRows } = await db.query(
      `INSERT INTO pregoes (cliente_id, objeto, orgao, valor_estimado, status)
       VALUES ($1,$2,$3,$4,'a_disputar') RETURNING id`,
      [
        interesse.cliente_id || null,
        interesse.titulo || interesse.orgao || 'Licitação via boletim',
        interesse.orgao || null,
        null,
      ],
    );
    const pregaoId = pgRows[0]?.id;

    await db.query(
      `UPDATE boletins_interesses SET status='convertido', convertido_em=NOW(), pregao_id=$1 WHERE id=$2`,
      [pregaoId, parseInt(id, 10)],
    );

    return res.json({ ok: true, pregao_id: pregaoId });
  } catch (err) {
    console.error('[BoletimFila] converterPregao:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// GET /api/boletim/historico
async function listarHistorico(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT b.*,
              (SELECT COUNT(*) FROM boletins_items     bi   WHERE bi.boletim_id   = b.id) AS total_items,
              (SELECT COUNT(*) FROM boletins_interesses bint WHERE bint.boletim_id = b.id) AS total_interesses
       FROM boletins b
       ORDER BY COALESCE(b.disparado_em, b.html_gerado_em, b.criado_em) DESC
       LIMIT 100`,
    );
    return res.json({ boletins: rows });
  } catch (err) {
    console.error('[BoletimFila] listarHistorico:', err.message);
    return res.status(500).json({ erro: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// HTML helper
// ─────────────────────────────────────────────────────────────
function _scoreColor(s) {
  if (s >= 8) return '#4CC5D7';
  if (s >= 7) return '#22c55e';
  if (s >= 5) return '#f59e0b';
  return '#ef4444';
}

function _badgeHTML(e) {
  const rec = e.recomendacao;
  const esc = v => (v || '').replace(/'/g, "\\'");
  const params = `'${esc(e.titulo)}','${esc(e.valor)}','${esc(e.prazo)}','${esc(e.orgao)}','${e.boletim_item_id||''}','${e.boletim_id||''}','${e.cliente_id||''}'`;
  if (rec === 'Participar') {
    return `<button onclick="alertarOportunidade(${params})"
      style="background:#4CC5D7;color:#fff;border:none;padding:6px 14px;border-radius:20px;
             font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.5px">✅ PARTICIPAR</button>`;
  }
  if (rec === 'Avaliar') {
    return `<button onclick="alertarOportunidade(${params})"
      style="background:#fef3c7;color:#92400e;border:none;padding:5px 12px;border-radius:20px;
             font-size:12px;font-weight:700;cursor:pointer">⚠️ AVALIAR</button>`;
  }
  return `<span style="background:#fee2e2;color:#991b1b;padding:5px 12px;border-radius:20px;font-size:12px;font-weight:700">❌ DISPENSAR</span>`;
}

function _buildHTML({ clienteNome, semana, dataGeracao, editais_triados, appUrl }) {
  const cardsHTML = (editais_triados || []).map(e => `
    <div style="background:#fff;border:1px solid #E2EAF0;border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="font-size:14px;font-weight:700;color:#182A39;margin-bottom:6px;line-height:1.4">${e.titulo || '—'}</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:10px">🏛 ${e.orgao || '—'} · 📍 ${e.uf || '—'}</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            ${e.valor ? `<span style="background:#f0f4f6;color:#475569;padding:3px 10px;border-radius:20px;font-size:11px">💰 ${e.valor}</span>` : ''}
            ${e.prazo ? `<span style="background:#f0f4f6;color:#475569;padding:3px 10px;border-radius:20px;font-size:11px">📅 Prazo: ${e.prazo}</span>` : ''}
          </div>
          ${e.justificativa ? `<div style="font-size:12px;color:#475569;border-left:3px solid #4CC5D7;padding-left:10px;font-style:italic">${e.justificativa}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;min-width:90px">
          <div style="width:52px;height:52px;border-radius:50%;background:${_scoreColor(e.score || 0)};display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#fff">${e.score || 0}</div>
          <div style="font-size:10px;color:#94a3b8;font-weight:600">SCORE</div>
          ${_badgeHTML(e)}
        </div>
      </div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Boletim de Licitações — ${clienteNome} — Semana ${semana}</title>
  <style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#F0F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.container{max-width:700px;margin:0 auto}@media(max-width:600px){body{padding:10px}}</style>
</head>
<body>
  <div class="container">
    <div style="background:#182A39;border-radius:12px;padding:28px 32px;margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <img src="${appUrl}/assets/images/logo-branca.png" style="height:36px" alt="Conlicit">
        <div style="text-align:right">
          <div style="color:#4CC5D7;font-size:13px;font-weight:700;letter-spacing:.5px">BOLETIM DE LICITAÇÕES</div>
          <div style="color:#94a3b8;font-size:11px;margin-top:2px">Semana ${semana} · ${dataGeracao}</div>
        </div>
      </div>
      <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1)">
        <div style="color:#fff;font-size:18px;font-weight:700">${clienteNome}</div>
        <div style="color:#94a3b8;font-size:13px;margin-top:4px">
          ${(editais_triados || []).length} edital(is) triado(s) · ${(editais_triados || []).filter(e => e.recomendacao === 'Participar').length} recomendado(s) para participar
        </div>
      </div>
    </div>
    ${cardsHTML || '<p style="color:#64748b;text-align:center;padding:40px 0">Nenhum edital neste boletim.</p>'}
    <div style="text-align:center;padding:24px 0;color:#94a3b8;font-size:12px;border-top:1px solid #E2EAF0;margin-top:8px">conlicit · Consultoria em Licitações Públicas</div>
  </div>
  <script>
    var _API = '${appUrl}';
    function alertarOportunidade(titulo, valor, prazo, orgao, boletimItemId, boletimId, clienteId) {
      if (boletimItemId || boletimId || clienteId) {
        fetch(_API + '/api/boletim/interesse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titulo: titulo, orgao: orgao, valor: valor, prazo: prazo,
            boletim_item_id: boletimItemId || null,
            boletim_id:      boletimId     || null,
            cliente_id:      clienteId     || null,
          }),
        }).catch(function(){});
      }
      var assunto = encodeURIComponent('Interesse em Licitação — ' + titulo);
      var corpo   = encodeURIComponent('Olá,\\n\\nTenho interesse na seguinte licitação:\\n\\n' +
        'Título: ' + titulo + '\\nÓrgão: ' + orgao + '\\nValor: ' + valor + '\\nPrazo: ' + prazo +
        '\\n\\nPor favor, entre em contato.');
      window.location.href = 'mailto:${CONLICIT_EMAIL}?subject=' + assunto + '&body=' + corpo;
      setTimeout(function() {
        var msg = encodeURIComponent('🏆 Olá! Tenho interesse na licitação:\\n' +
          '📋 ' + titulo + '\\n🏛 ' + orgao + '\\n💰 ' + valor + '\\n📅 Prazo: ' + prazo);
        window.open('https://wa.me/${CONLICIT_WHATSAPP}?text=' + msg, '_blank');
      }, 800);
    }
  </script>
</body>
</html>`;
}

module.exports = {
  listarFila, adicionarFila, atualizarCliente, descartarFila, gerarBoletimDaFila,
  registrarInteresse, listarInteressesCliente, atualizarInteresse, converterPregao,
  listarHistorico,
};
