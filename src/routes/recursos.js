const express    = require('express');
const db         = require('../database/db');
const autenticar = require('../middleware/autenticar');
const { callClaude } = require('../services/edsonService');

const router = express.Router();
router.use(autenticar);

// POST /recursos/gerar — gera minuta de recurso com IA
router.post('/gerar', async (req, res) => {
  const { pregao_id, cliente_id, tipo = 'recurso', motivo } = req.body ?? {};
  if (!cliente_id || !motivo?.trim()) {
    return res.status(400).json({ erro: 'cliente_id e motivo são obrigatórios' });
  }

  try {
    const { rows: [cliente] } = await db.query(
      `SELECT nome, razao_social, cnpj, responsavel_legal, cargo_responsavel, cpf_responsavel, endereco
       FROM clientes WHERE id = $1`,
      [cliente_id],
    );
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

    let contextoEdital = '';
    if (pregao_id) {
      const { rows: [pregao] } = await db.query(
        `SELECT p.numero, p.orgao, p.objeto, a.resumo_executivo, a.riscos
         FROM pregoes p
         LEFT JOIN analises_edson a ON a.pregao_id = p.id
         WHERE p.id = $1`,
        [pregao_id],
      );
      if (pregao) {
        contextoEdital = `\nDADOS DO PREGÃO:\nNúmero: ${pregao.numero || '—'}\nÓrgão: ${pregao.orgao || '—'}\nObjeto: ${pregao.objeto || '—'}`;
        if (pregao.resumo_executivo) contextoEdital += `\nResumo do Edital: ${pregao.resumo_executivo}`;
      }
    }

    const nomeSocial = cliente.razao_social || cliente.nome;
    const tipoLabel  = tipo === 'recurso' ? 'RECURSO ADMINISTRATIVO' : tipo === 'impugnacao' ? 'IMPUGNAÇÃO AO EDITAL' : 'CONTRARRAZÕES';

    const prompt = `Você é o Edson, especialista jurídico da Conlicit em licitações públicas.
Redija um ${tipoLabel} completo, fundamentado na Lei nº 14.133/2021 (Nova Lei de Licitações) e na legislação complementar aplicável.

EMPRESA RECORRENTE:
Razão Social: ${nomeSocial}
CNPJ: ${cliente.cnpj || '—'}
Responsável Legal: ${cliente.responsavel_legal || '—'}
CPF: ${cliente.cpf_responsavel || '—'}
Endereço: ${cliente.endereco || '—'}
${contextoEdital}

MOTIVO / FATO QUE ORIGINOU O ${tipoLabel}:
${motivo}

INSTRUÇÕES:
- Use linguagem jurídica formal, precisa e objetiva
- Cite os artigos da Lei 14.133/2021 aplicáveis
- Estruture com: CABEÇALHO, DO CABIMENTO, DOS FATOS, DO DIREITO (com citações legais), DO PEDIDO, DATA E ASSINATURA
- No lugar da data, coloque "[LOCAL], [DATA]"
- Na assinatura, coloque os dados do responsável legal
- Retorne o texto completo em HTML simples (use <h2>, <p>, <br>, <strong> apenas)
- Não use markdown, não use ```html, retorne apenas HTML puro`;

    const html = await callClaude(prompt, 4000);

    const { rows: [recurso] } = await db.query(
      `INSERT INTO recursos_licitatorios (pregao_id, cliente_id, tipo, motivo, conteudo_html, status, criado_por)
       VALUES ($1,$2,$3,$4,$5,'rascunho',$6) RETURNING *`,
      [pregao_id || null, cliente_id, tipo, motivo, html, req.usuario?.id || null],
    );

    return res.json({ sucesso: true, recurso });
  } catch (e) {
    console.error('[Recursos] gerar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

// GET /recursos?cliente_id=X
router.get('/', async (req, res) => {
  const { cliente_id } = req.query;
  try {
    const { rows } = await db.query(
      `SELECT r.*, c.nome AS cliente_nome, p.numero AS pregao_numero
       FROM recursos_licitatorios r
       JOIN clientes c ON c.id = r.cliente_id
       LEFT JOIN pregoes p ON p.id = r.pregao_id
       ${cliente_id ? 'WHERE r.cliente_id = $1' : ''}
       ORDER BY r.created_at DESC`,
      cliente_id ? [cliente_id] : [],
    );
    return res.json({ sucesso: true, dados: rows });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

// GET /recursos/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [r] } = await db.query(
      `SELECT r.*, c.nome AS cliente_nome, c.razao_social, c.cnpj, c.logo_base64,
              c.responsavel_legal, c.cargo_responsavel, c.cpf_responsavel, c.endereco,
              p.numero AS pregao_numero
       FROM recursos_licitatorios r
       JOIN clientes c ON c.id = r.cliente_id
       LEFT JOIN pregoes p ON p.id = r.pregao_id
       WHERE r.id = $1`,
      [req.params.id],
    );
    if (!r) return res.status(404).json({ erro: 'Recurso não encontrado' });
    return res.json({ sucesso: true, dados: r });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
