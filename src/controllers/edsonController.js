const db = require('../database/db');
const { analisarPregao, chamarClaude } = require('../services/edsonService');

async function listar(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.pregao_id, a.status, a.score, a.resumo_executivo,
              a.criado_em, a.atualizado_em,
              p.numero AS pregao_numero, p.orgao,
              c.nome AS cliente_nome
       FROM analises_edson a
       JOIN pregoes p ON p.id = a.pregao_id
       JOIN clientes c ON c.id = p.cliente_id
       ORDER BY a.atualizado_em DESC
       LIMIT 50`,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Edson] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function disparar(req, res) {
  const { pregao_id } = req.params;
  try {
    const { rows: [pregao] } = await db.query('SELECT id FROM pregoes WHERE id = $1', [pregao_id]);
    if (!pregao) return res.status(404).json({ erro: 'Pregão não encontrado' });

    const { rows: [analise] } = await db.query(
      `INSERT INTO analises_edson (pregao_id, status)
       VALUES ($1, 'processando')
       ON CONFLICT (pregao_id) DO UPDATE SET
         status = 'processando', score = NULL, score_justificativa = NULL,
         resumo_executivo = NULL, modalidade = NULL, modo_disputa = NULL,
         tipo_julgamento = NULL, itens = '[]', habilitacao = '[]',
         riscos = '[]', checklist = '{"antes":[],"durante":[]}',
         erro_mensagem = NULL, atualizado_em = NOW()
       RETURNING id`,
      [pregao_id],
    );

    analisarPregao(analise.id, parseInt(pregao_id, 10)).catch(console.error);

    return res.json({ id: analise.id, status: 'processando' });
  } catch (e) {
    console.error('[Edson] disparar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function obter(req, res) {
  const { pregao_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `SELECT a.*, p.numero AS pregao_numero, p.orgao, p.objeto,
              c.nome AS cliente_nome
       FROM analises_edson a
       JOIN pregoes p ON p.id = a.pregao_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE a.pregao_id = $1`,
      [pregao_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });
    return res.json(analise);
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function chat(req, res) {
  const { pregao_id } = req.params;
  const { mensagem } = req.body ?? {};
  if (!mensagem?.trim()) return res.status(400).json({ erro: 'mensagem é obrigatória' });

  try {
    const { rows: [analise] } = await db.query(
      `SELECT a.id, a.status, a.score, a.resumo_executivo,
              p.numero, p.orgao, p.objeto, p.valor_estimado,
              c.nome AS cliente_nome, c.uf
       FROM analises_edson a
       JOIN pregoes p ON p.id = a.pregao_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE a.pregao_id = $1`,
      [pregao_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });
    if (analise.status !== 'pronto')
      return res.status(400).json({ erro: 'Análise ainda não concluída' });

    const { rows: historico } = await db.query(
      `SELECT role, content FROM chat_edson WHERE analise_id = $1 ORDER BY criado_em ASC`,
      [analise.id],
    );

    await db.query(
      `INSERT INTO chat_edson (analise_id, role, content) VALUES ($1, 'user', $2)`,
      [analise.id, mensagem.trim()],
    );

    const systemPrompt = `Você é o Edson, assistente especialista em licitações públicas brasileiras do ConlicitHub.

Pregão em análise:
- Número: ${analise.numero}
- Órgão: ${analise.orgao || '—'}
- Objeto: ${analise.objeto || '—'}
- Valor estimado: ${analise.valor_estimado ? `R$ ${analise.valor_estimado}` : '—'}
- Cliente: ${analise.cliente_nome} (${analise.uf || '—'})
- Score de oportunidade: ${analise.score}/100
- Resumo: ${analise.resumo_executivo || '—'}

Responda de forma concisa e prática. Use markdown quando útil.`;

    const messages = [
      ...historico.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: mensagem.trim() },
    ];

    const resposta = await chamarClaude(systemPrompt, messages);

    await db.query(
      `INSERT INTO chat_edson (analise_id, role, content) VALUES ($1, 'assistant', $2)`,
      [analise.id, resposta],
    );

    return res.json({ resposta });
  } catch (e) {
    console.error('[Edson] chat:', e.message);
    return res.status(500).json({ erro: 'Erro ao processar pergunta' });
  }
}

async function getChatHistorico(req, res) {
  const { pregao_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `SELECT id FROM analises_edson WHERE pregao_id = $1`, [pregao_id],
    );
    if (!analise) return res.json({ dados: [] });

    const { rows } = await db.query(
      `SELECT role, content, criado_em FROM chat_edson WHERE analise_id = $1 ORDER BY criado_em ASC`,
      [analise.id],
    );
    return res.json({ dados: rows });
  } catch {
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function planilha(req, res) {
  const { pregao_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `SELECT a.itens, p.numero, c.nome AS cliente_nome
       FROM analises_edson a
       JOIN pregoes p ON p.id = a.pregao_id
       JOIN clientes c ON c.id = p.cliente_id
       WHERE a.pregao_id = $1 AND a.status = 'pronto'`,
      [pregao_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada ou não concluída' });

    const itens = analise.itens ?? [];
    const cab = 'Nº Item;Descrição;Unidade;Quantidade;Valor Unitário Estimado;Meu Preço Unitário;Meu Preço Total;Observação';
    const linhas = itens.map((item) => [
      item.numero ?? '',
      `"${String(item.descricao ?? '').replace(/"/g, '""')}"`,
      item.unidade ?? '',
      item.quantidade ?? '',
      item.valor_unitario_estimado ?? '',
      '',
      '',
      '',
    ].join(';'));

    const csv = '﻿' + [cab, ...linhas].join('\r\n');
    const filename = `planilha-${(analise.numero || pregao_id).replace(/[^a-z0-9]/gi, '-')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = { listar, disparar, obter, chat, getChatHistorico, planilha };
