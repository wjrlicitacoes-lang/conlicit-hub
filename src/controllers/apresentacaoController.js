const db = require('../database/db');

const CAMPOS_EDITAVEIS = [
  'segmento', 'licitacoes_totais', 'licitacoes_vencidas', 'valor_total',
  'custo_assinatura', 'tempo_antes_horas', 'tempo_depois_horas',
  'modulo_principal', 'historia_breve', 'feedback_cliente',
];

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

exports.listar = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        id, cliente_id, segmento, licitacoes_totais, licitacoes_vencidas,
        valor_total, custo_assinatura, tempo_antes_horas, tempo_depois_horas,
        modulo_principal, historia_breve, feedback_cliente,
        criado_em, atualizado_em
      FROM resultado_apresentacoes
      ORDER BY atualizado_em DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[apresentacao/listar]', err);
    res.status(500).json({ erro: err.message });
  }
};

exports.obter = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM resultado_apresentacoes WHERE id = $1',
      [req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[apresentacao/obter]', err);
    res.status(500).json({ erro: err.message });
  }
};

exports.criar = async (req, res) => {
  try {
    const {
      cliente_id, segmento, licitacoes_totais, licitacoes_vencidas,
      valor_total, custo_assinatura, tempo_antes_horas, tempo_depois_horas,
      modulo_principal, historia_breve, feedback_cliente,
    } = req.body ?? {};

    if (!cliente_id) return res.status(400).json({ erro: 'cliente_id é obrigatório' });

    const { rows } = await db.query(`
      INSERT INTO resultado_apresentacoes (
        cliente_id, segmento, licitacoes_totais, licitacoes_vencidas,
        valor_total, custo_assinatura, tempo_antes_horas, tempo_depois_horas,
        modulo_principal, historia_breve, feedback_cliente, criado_por
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      cliente_id, segmento || null, licitacoes_totais || 0, licitacoes_vencidas || 0,
      valor_total || 0, custo_assinatura || 0, tempo_antes_horas || 0, tempo_depois_horas || 0,
      modulo_principal || null, historia_breve || null, feedback_cliente || null, req.usuario?.id,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[apresentacao/criar]', err);
    res.status(500).json({ erro: err.message });
  }
};

exports.atualizar = async (req, res) => {
  try {
    const updates = req.body ?? {};

    const campos = [];
    const valores = [];
    let contador = 1;

    Object.entries(updates).forEach(([chave, valor]) => {
      if (CAMPOS_EDITAVEIS.includes(chave)) {
        campos.push(`${chave} = $${contador}`);
        valores.push(valor);
        contador++;
      }
    });

    if (campos.length === 0) {
      return res.status(400).json({ erro: 'Nenhum campo válido para atualizar' });
    }

    campos.push('atualizado_em = NOW()');
    valores.push(req.params.id);

    const sql = `UPDATE resultado_apresentacoes SET ${campos.join(', ')} WHERE id = $${contador} RETURNING *`;

    const { rows } = await db.query(sql, valores);
    if (rows.length === 0) return res.status(404).json({ erro: 'Não encontrado' });

    res.json(rows[0]);
  } catch (err) {
    console.error('[apresentacao/atualizar]', err);
    res.status(500).json({ erro: err.message });
  }
};

exports.remover = async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM resultado_apresentacoes WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Não encontrado' });
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error('[apresentacao/remover]', err);
    res.status(500).json({ erro: err.message });
  }
};

exports.gerar = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM resultado_apresentacoes WHERE id = $1',
      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ erro: 'Não encontrado' });
    }

    let totalROI = 0, totalTaxaVitoria = 0;
    const stats = rows.map((r) => {
      const taxa = r.licitacoes_totais > 0
        ? Math.round((r.licitacoes_vencidas / r.licitacoes_totais) * 100)
        : 0;
      const roi = r.custo_assinatura > 0 ? r.valor_total / r.custo_assinatura : 0;
      totalROI += roi;
      totalTaxaVitoria += taxa;
      return { ...r, taxa, roi };
    });

    const mediaROI = (totalROI / rows.length).toFixed(1);
    const mediaTaxa = Math.round(totalTaxaVitoria / rows.length);
    const totalValor = rows.reduce((s, r) => s + Number(r.valor_total), 0);

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conlicit — Apresentação de Resultados</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    header { background: #182A39; color: white; padding: 30px; border-radius: 8px; text-align: center; margin-bottom: 30px; }
    header h1 { font-size: 28px; margin-bottom: 8px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 30px; }
    .stat { background: #182A39; color: white; padding: 20px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: 600; margin-bottom: 4px; }
    .stat-label { font-size: 12px; opacity: 0.8; text-transform: uppercase; }
    .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #4CC5D7; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card h3 { color: #182A39; margin-bottom: 12px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 12px; }
    .metric { background: #f8f9fa; padding: 12px; border-radius: 6px; text-align: center; font-size: 13px; }
    .metric-value { font-size: 18px; font-weight: 600; color: #4CC5D7; }
    .metric-label { font-size: 11px; color: #666; margin-top: 4px; text-transform: uppercase; }
    .text { font-size: 13px; color: #555; margin-bottom: 8px; line-height: 1.5; }
    .feedback { font-size: 13px; color: #555; font-style: italic; padding: 12px; background: #f0f9fb; border-left: 2px solid #4CC5D7; border-radius: 4px; margin-top: 12px; }
    footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #999; }
    @media print { body { background: white; } .card { page-break-inside: avoid; box-shadow: none; } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Conlicit</h1>
      <p>Apresentação de Resultados</p>
    </header>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${mediaROI}x</div>
        <div class="stat-label">ROI Médio</div>
      </div>
      <div class="stat">
        <div class="stat-value">${mediaTaxa}%</div>
        <div class="stat-label">Taxa de Vitória</div>
      </div>
      <div class="stat">
        <div class="stat-value">${rows.length}</div>
        <div class="stat-label">Clientes</div>
      </div>
      <div class="stat">
        <div class="stat-value">R$ ${(totalValor / 1000).toFixed(0)}k</div>
        <div class="stat-label">Valor Total</div>
      </div>
    </div>

    ${stats.map((r, i) => `
      <div class="card">
        <h3>Cliente ${i + 1}${r.segmento ? ` — ${escapeHtml(r.segmento)}` : ''}</h3>
        <div class="metrics">
          <div class="metric">
            <div class="metric-value">${r.taxa}%</div>
            <div class="metric-label">Taxa de vitória</div>
          </div>
          <div class="metric">
            <div class="metric-value">${r.roi.toFixed(1)}x</div>
            <div class="metric-label">ROI</div>
          </div>
          <div class="metric">
            <div class="metric-value">R$ ${(r.valor_total / 1000).toFixed(0)}k</div>
            <div class="metric-label">Valor ganho</div>
          </div>
          <div class="metric">
            <div class="metric-value">${(r.tempo_antes_horas - r.tempo_depois_horas).toFixed(1)}h</div>
            <div class="metric-label">Economia/sem</div>
          </div>
        </div>
        ${r.modulo_principal ? `<div class="text"><strong>Módulo:</strong> ${escapeHtml(r.modulo_principal)}</div>` : ''}
        ${r.historia_breve ? `<div class="text"><strong>Caso:</strong> ${escapeHtml(r.historia_breve)}</div>` : ''}
        ${r.feedback_cliente ? `<div class="feedback">"${escapeHtml(r.feedback_cliente)}"</div>` : ''}
      </div>
    `).join('')}

    <footer>
      <p>Conlicit — Consultoria em Licitações Públicas | Belo Horizonte, MG</p>
      <p>Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
    </footer>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('[apresentacao/gerar]', err);
    res.status(500).json({ erro: err.message });
  }
};
