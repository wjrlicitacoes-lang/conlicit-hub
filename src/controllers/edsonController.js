const multer = require('multer');
const db = require('../database/db');
const { analisarPregao, analisarPDF, analisarAvulso, reanalisarComSuplementos, chamarClaude } = require('../services/edsonService');
const pdfParse = require('pdf-parse');
const { gerarPlanilhaXLSX }       = require('../services/planilhaService');
const { gerarRelatorioPDF }        = require('../services/relatorioService');
const { gerarHTMLResumo } = require('../services/relatorioSimplesService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

const uploadImagemMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

// ── SELECT helpers ─────────────────────────────────────────────────────────────

const SELECT_ANALISE_COMPLETA = `
  SELECT a.*, a.referencia,
         p.numero AS pregao_numero, p.orgao, p.objeto, p.link_pncp, p.numero_controle_pncp,
         p.valor_estimado,
         c.nome AS cliente_nome, c.uf
  FROM analises_edson a
  LEFT JOIN pregoes p ON p.id = a.pregao_id
  LEFT JOIN clientes c ON c.id = p.cliente_id`;

// Query completa com aliases explícitos para uso nos relatórios — cobre tanto análises
// vinculadas a pregão quanto análises avulsas (cliente via a.cliente_id como fallback)
const SELECT_ANALISE_RELATORIO = `
  SELECT a.*,
         p.numero          AS pregao_numero,
         p.orgao           AS pregao_orgao,
         p.objeto          AS pregao_objeto,
         p.valor_estimado  AS pregao_valor_estimado,
         p.data_abertura   AS pregao_data_abertura,
         p.data_hora_abertura,
         p.numero_controle_pncp,
         p.link_pncp,
         p.portal_disputa,
         c.nome            AS cliente_nome,
         c.uf              AS cliente_uf
  FROM analises_edson a
  LEFT JOIN pregoes p ON p.id = a.pregao_id
  LEFT JOIN clientes c ON c.id = COALESCE(p.cliente_id, a.cliente_id)`;

// ── Listar ────────────────────────────────────────────────────────────────────

async function listar(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.pregao_id, a.referencia, a.status, a.score, a.resumo_executivo,
              a.criado_em, a.atualizado_em,
              p.numero AS pregao_numero, p.orgao,
              c.nome AS cliente_nome
       FROM analises_edson a
       LEFT JOIN pregoes p ON p.id = a.pregao_id
       LEFT JOIN clientes c ON c.id = p.cliente_id
       ORDER BY a.atualizado_em DESC
       LIMIT 50`,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('[Edson] listar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Disparar (por pregão) ──────────────────────────────────────────────────────

async function disparar(req, res) {
  const { pregao_id } = req.params;
  try {
    const { rows: [pregao] } = await db.query('SELECT id FROM pregoes WHERE id = $1', [pregao_id]);
    if (!pregao) return res.status(404).json({ erro: 'Pregão não encontrado' });

    const { rows: [analise] } = await db.query(
      `INSERT INTO analises_edson (pregao_id, status)
       VALUES ($1, 'aguardando_pdf')
       ON CONFLICT (pregao_id) DO UPDATE SET
         status = 'aguardando_pdf', score = NULL, score_justificativa = NULL,
         resumo_executivo = NULL, modalidade = NULL, modo_disputa = NULL,
         tipo_julgamento = NULL, itens = '[]', habilitacao = '[]',
         riscos = '[]', checklist = '{"antes":[],"durante":[]}',
         criterios_score = NULL, erro_mensagem = NULL, atualizado_em = NOW()
       RETURNING id`,
      [pregao_id],
    );

    return res.json({ id: analise.id, status: 'aguardando_pdf' });
  } catch (e) {
    console.error('[Edson] disparar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Avulso ────────────────────────────────────────────────────────────────────

async function avulso(req, res) {
  try {
    const { numero_controle_pncp, referencia, cliente_id, modo } = req.body ?? {};
    if (!referencia?.trim() && !numero_controle_pncp?.trim() && !req.file) {
      return res.status(400).json({ erro: 'Informe referência, número PNCP ou PDF' });
    }

    let clienteNome = null, clienteUF = null, palavrasChave = null;
    if (cliente_id) {
      const { rows: [c] } = await db.query(
        'SELECT nome, uf, palavras_chave FROM clientes WHERE id = $1', [cliente_id],
      );
      if (c) { clienteNome = c.nome; clienteUF = c.uf; palavrasChave = c.palavras_chave; }
    }

    const ref = referencia?.trim() || numero_controle_pncp || 'Análise avulsa';

    if (req.file) {
      // PDF enviado: análise começa imediatamente
      const { rows: [analise] } = await db.query(
        `INSERT INTO analises_edson (pregao_id, referencia, cliente_id, status)
         VALUES (NULL, $1, $2, 'processando')
         RETURNING id`,
        [ref, cliente_id || null],
      );
      analisarAvulso(analise.id, {
        numero_controle_pncp: numero_controle_pncp?.trim() || null,
        referencia: ref,
        clienteNome, clienteUF,
        palavrasChave: Array.isArray(palavrasChave) ? palavrasChave.join(', ') : palavrasChave,
        pdfBuffer: req.file.buffer,
        modo: modo || 'reuniao',
      }).catch(console.error);
      return res.json({ mensagem: 'Análise avulsa iniciada', analise_id: analise.id });
    }

    // Sem PDF: aguarda upload
    const { rows: [analise] } = await db.query(
      `INSERT INTO analises_edson (pregao_id, referencia, cliente_id, status)
       VALUES (NULL, $1, $2, 'aguardando_pdf')
       RETURNING id`,
      [ref, cliente_id || null],
    );
    return res.json({ mensagem: 'Aguardando PDF do edital', analise_id: analise.id });
  } catch (e) {
    console.error('[Edson] avulso:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Obter por pregao_id ───────────────────────────────────────────────────────

async function obter(req, res) {
  const { pregao_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `${SELECT_ANALISE_COMPLETA} WHERE a.pregao_id = $1`, [pregao_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });
    return res.json(analise);
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Obter por analise_id (avulso) ─────────────────────────────────────────────

async function obterPorId(req, res) {
  const { analise_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `${SELECT_ANALISE_COMPLETA} WHERE a.id = $1`, [analise_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });
    return res.json(analise);
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────

async function chat(req, res) {
  const { pregao_id } = req.params;
  const { mensagem } = req.body ?? {};
  if (!mensagem?.trim()) return res.status(400).json({ erro: 'mensagem é obrigatória' });

  try {
    const { rows: [analise] } = await db.query(
      `SELECT a.id, a.status, a.score, a.resumo_executivo, a.referencia,
              p.numero, p.orgao, p.objeto, p.valor_estimado,
              c.nome AS cliente_nome, c.uf
       FROM analises_edson a
       LEFT JOIN pregoes p ON p.id = a.pregao_id
       LEFT JOIN clientes c ON c.id = p.cliente_id
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

    const systemPrompt = `Você é o Edson, especialista sênior em licitações da Conlicit.

Licitação em análise:
- Número/Ref: ${analise.numero || analise.referencia || '—'}
- Órgão: ${analise.orgao || '—'}
- Objeto: ${analise.objeto || '—'}
- Valor estimado: ${analise.valor_estimado ? `R$ ${analise.valor_estimado}` : '—'}
- Cliente: ${analise.cliente_nome || '—'} (${analise.uf || '—'})
- Score: ${analise.score}/100
- Resumo: ${analise.resumo_executivo || '—'}

REGRAS ABSOLUTAS:
1. Máximo 2 frases por resposta
2. NUNCA invente, assuma ou deduza informações não explicitamente presentes no documento
3. Se uma informação não estiver no edital, diga exatamente isso — não suponha
4. Responda o que fazer, não o que o edital diz
5. Sem markdown, sem bullets, sem títulos
6. Se não tiver certeza: diga o valor ou prazo exato que encontrou, sem qualificações`;

    const messages = [
      ...historico.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: mensagem.trim() },
    ];

    const resposta = await chamarClaude(systemPrompt, messages);

    await db.query(
      `INSERT INTO chat_edson (analise_id, role, content) VALUES ($1, 'assistant', $2)`,
      [analise.id, resposta],
    );

    return res.json({ resposta, analise_id: analise.id, pregao_numero: analise.numero, orgao: analise.orgao, pergunta: mensagem.trim() });
  } catch (e) {
    console.error('[Edson] chat:', e.message);
    return res.status(500).json({ erro: 'Erro ao processar pergunta' });
  }
}

// ── Chat por analise_id ───────────────────────────────────────────────────────

async function chatPorId(req, res) {
  const { analise_id } = req.params;
  const { mensagem } = req.body ?? {};
  if (!mensagem?.trim()) return res.status(400).json({ erro: 'mensagem é obrigatória' });

  try {
    const { rows: [analise] } = await db.query(
      `SELECT a.id, a.status, a.score, a.resumo_executivo, a.referencia,
              p.numero, p.orgao, p.objeto, p.valor_estimado,
              c.nome AS cliente_nome, c.uf
       FROM analises_edson a
       LEFT JOIN pregoes p ON p.id = a.pregao_id
       LEFT JOIN clientes c ON c.id = p.cliente_id
       WHERE a.id = $1`,
      [analise_id],
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

    const systemPrompt = `Você é o Edson, especialista sênior em licitações da Conlicit.
Licitação: ${analise.numero || analise.referencia || '—'} | Score: ${analise.score}/100
REGRAS: máximo 2 frases, sem markdown, responda o que fazer (não o que diz o edital).`;

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
    console.error('[Edson] chatPorId:', e.message);
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

async function getChatHistoricoPorId(req, res) {
  const { analise_id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT role, content, criado_em FROM chat_edson WHERE analise_id = $1 ORDER BY criado_em ASC`,
      [analise_id],
    );
    return res.json({ dados: rows });
  } catch {
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Planilha / Relatório ──────────────────────────────────────────────────────

async function planilha(req, res) {
  const { pregao_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `${SELECT_ANALISE_RELATORIO} WHERE a.pregao_id = $1 AND a.status = 'pronto'`,
      [pregao_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada ou não concluída' });
    const buffer = await gerarPlanilhaXLSX({ analise, pregao: analise });
    const filename = `planilha-${(analise.numero || pregao_id).replace(/[^a-z0-9]/gi, '-')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (e) {
    console.error('[Edson] planilha:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function relatorio(req, res) {
  const { pregao_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `${SELECT_ANALISE_RELATORIO} WHERE a.pregao_id = $1 AND a.status = 'pronto'`,
      [pregao_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada ou não concluída' });
    const buffer = await gerarRelatorioPDF({ analise, pregao: analise, cliente: { nome: analise.cliente_nome, uf: analise.cliente_uf } });
    const filename = `relatorio-edson-${(analise.numero || pregao_id).replace(/[^a-z0-9]/gi, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (e) {
    console.error('[Edson] relatorio:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Upload PDF ────────────────────────────────────────────────────────────────

async function uploadPDF(req, res) {
  const { pregao_id } = req.params;
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo PDF obrigatório (campo: edital)' });
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
         criterios_score = NULL, erro_mensagem = NULL, atualizado_em = NOW()
       RETURNING id`,
      [pregao_id],
    );

    const { modo: modoUpload } = req.body ?? {};
    analisarPDF(analise.id, parseInt(pregao_id, 10), req.file.buffer, modoUpload || 'reuniao').catch(console.error);
    return res.json({ mensagem: 'Análise iniciada', analise_id: analise.id });
  } catch (e) {
    console.error('[Edson] uploadPDF:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Upload PDF para análise avulsa ────────────────────────────────────────────

async function uploadPDFAvulso(req, res) {
  const { analise_id } = req.params;
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo PDF obrigatório (campo: edital)' });

    const { rows: [analise] } = await db.query(
      `SELECT ae.id, ae.referencia, ae.cliente_id,
              c.nome AS cliente_nome, c.uf, c.palavras_chave
       FROM analises_edson ae
       LEFT JOIN clientes c ON c.id = ae.cliente_id
       WHERE ae.id = $1`,
      [analise_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });

    await db.query(
      `UPDATE analises_edson SET status = 'processando', atualizado_em = NOW() WHERE id = $1`,
      [analise_id],
    );

    const { modo: modoAvulso } = req.body ?? {};
    analisarAvulso(parseInt(analise_id, 10), {
      referencia: analise.referencia || 'Análise avulsa',
      clienteNome: analise.cliente_nome || null,
      clienteUF: analise.uf || null,
      palavrasChave: Array.isArray(analise.palavras_chave)
        ? analise.palavras_chave.join(', ')
        : analise.palavras_chave,
      pdfBuffer: req.file.buffer,
      modo: modoAvulso || 'reuniao',
    }).catch(console.error);

    return res.json({ mensagem: 'Análise iniciada', analise_id: parseInt(analise_id, 10) });
  } catch (e) {
    console.error('[Edson] uploadPDFAvulso:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Relatório Simples (1 pág para reunião de vendas) ─────────────────────────

async function relatorioSimples(req, res) {
  const { pregao_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `${SELECT_ANALISE_RELATORIO} WHERE a.pregao_id = $1`,
      [pregao_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });

    const html = gerarHTMLResumo(analise);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (e) {
    console.error('[Edson] relatorioSimples:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Relatório Simples por analise_id (avulso sem pregao_id) ─────────────────

async function relatorioSimplesAvulso(req, res) {
  const { analise_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `${SELECT_ANALISE_RELATORIO} WHERE a.id = $1`,
      [analise_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada' });

    const html = gerarHTMLResumo(analise);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (e) {
    console.error('[Edson] relatorioSimplesAvulso:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Planilha por analise_id (avulso sem pregao_id) ───────────────────────────

async function planilhaAvulso(req, res) {
  const { analise_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `${SELECT_ANALISE_RELATORIO} WHERE a.id = $1 AND a.status = 'pronto'`,
      [analise_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada ou não concluída' });
    const buffer = await gerarPlanilhaXLSX({ analise, pregao: analise });
    const filename = `planilha-${(analise.numero || analise.referencia || analise_id).replace(/[^a-z0-9]/gi, '-')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (e) {
    console.error('[Edson] planilhaAvulso:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Relatório PDF por analise_id (avulso sem pregao_id) ─────────────────────

async function relatorioAvulso(req, res) {
  const { analise_id } = req.params;
  try {
    const { rows: [analise] } = await db.query(
      `${SELECT_ANALISE_RELATORIO} WHERE a.id = $1 AND a.status = 'pronto'`,
      [analise_id],
    );
    if (!analise) return res.status(404).json({ erro: 'Análise não encontrada ou não concluída' });
    const buffer = await gerarRelatorioPDF({ analise, pregao: analise, cliente: { nome: analise.cliente_nome, uf: analise.cliente_uf } });
    const filename = `relatorio-edson-${(analise.numero || analise.referencia || analise_id).replace(/[^a-z0-9]/gi, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (e) {
    console.error('[Edson] relatorioAvulso:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Vincular análise avulsa a um cliente ─────────────────────────────────────

async function vincularCliente(req, res) {
  const { analise_id } = req.params;
  const { cliente_id } = req.body ?? {};
  if (!cliente_id) return res.status(400).json({ erro: 'cliente_id é obrigatório' });

  try {
    const { rows: [cliente] } = await db.query(
      'SELECT id, nome FROM clientes WHERE id = $1', [cliente_id],
    );
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

    await db.query(
      'UPDATE analises_edson SET cliente_id = $1, atualizado_em = NOW() WHERE id = $2',
      [cliente_id, analise_id],
    );
    return res.json({ mensagem: `Análise vinculada a ${cliente.nome}`, cliente_nome: cliente.nome });
  } catch (e) {
    console.error('[Edson] vincularCliente:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Descartar análise avulsa ──────────────────────────────────────────────────

async function descartarAnalise(req, res) {
  const { analise_id } = req.params;
  try {
    const { rowCount } = await db.query(
      'DELETE FROM analises_edson WHERE id = $1', [analise_id],
    );
    if (rowCount === 0) return res.status(404).json({ erro: 'Análise não encontrada' });
    return res.json({ mensagem: 'Análise descartada' });
  } catch (e) {
    console.error('[Edson] descartarAnalise:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Upload de imagem PNCP (print de tela) ─────────────────────────────────────

async function uploadImagemPNCP(req, res) {
  const { analise_id } = req.params;
  try {
    if (!req.file) return res.status(400).json({ erro: 'Imagem obrigatória (JPG, PNG ou WEBP)' });
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    await db.query(
      `UPDATE analises_edson SET imagem_pncp_base64 = $2, atualizado_em = NOW() WHERE id = $1`,
      [analise_id, base64],
    );
    reanalisarComSuplementos(parseInt(analise_id, 10)).catch(console.error);
    return res.json({ mensagem: 'Imagem salva. Edson vai incluir na reanálise.' });
  } catch (e) {
    console.error('[Edson] uploadImagemPNCP:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// ── Upload de PDF complementar (TR / Anexo de itens) ─────────────────────────

async function uploadComplementar(req, res) {
  const { analise_id } = req.params;
  try {
    if (!req.file) return res.status(400).json({ erro: 'Arquivo PDF obrigatório' });
    const pdfData = await pdfParse(req.file.buffer);
    const texto = pdfData.text.trim().slice(0, 15000);
    if (!texto) return res.status(400).json({ erro: 'Não foi possível extrair texto do PDF' });
    await db.query(
      `UPDATE analises_edson SET arquivo_complementar_texto = $2, atualizado_em = NOW() WHERE id = $1`,
      [analise_id, texto],
    );
    reanalisarComSuplementos(parseInt(analise_id, 10)).catch(console.error);
    return res.json({ mensagem: 'Documento recebido. Edson vai reanalisar.' });
  } catch (e) {
    console.error('[Edson] uploadComplementar:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

module.exports = {
  listar, disparar, avulso, obter, obterPorId,
  chat, chatPorId, getChatHistorico, getChatHistoricoPorId,
  planilha, relatorio, relatorioSimples, uploadPDF, uploadPDFAvulso, upload,
  uploadImagemMulter, uploadImagemPNCP, uploadComplementar,
  vincularCliente, descartarAnalise,
  relatorioSimplesAvulso, planilhaAvulso, relatorioAvulso,
};
