// src/controllers/captacaoController.js
const db   = require('../database/db');
const axios = require('axios');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function notaOrigem(origem, dados) {
  if (origem === 'quiz') {
    const r = dados.respostas || {};
    return [`[Lead via Quiz de Diagnóstico — ${new Date().toLocaleDateString('pt-BR')}]`,`Frequência de licitações: ${r.frequencia || '—'}`,`Já foi desclassificado: ${r.desclassificado || '—'}`,`Maior dificuldade: ${r.dificuldade || '—'}`,`Usa ferramenta hoje: ${r.ferramenta || '—'}`,`Interesse declarado: ${r.interesse || '—'}`].join('\n');
  }
  if (origem === 'analisador') {
    return [`[Lead via Analisador de Edital — ${new Date().toLocaleDateString('pt-BR')}]`,`Número PNCP analisado: ${dados.numero_pncp || '—'}`,`Segmento: ${dados.segmento || '—'}`].join('\n');
  }
  return `[Lead via site — ${new Date().toLocaleDateString('pt-BR')}]`;
}

async function gerarAnalisePublica(referencia, segmento) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('API não configurada');
  const prompt = `Você é o Edson, especialista em licitações públicas brasileiras da Conlicit.\nUm fornecedor do segmento "${segmento || 'geral'}" quer saber se vale participar da licitação "${referencia}".\nGere uma análise RESUMIDA e GRATUITA com exatamente este JSON:\n{"resumo":"<2 frases>","pontos_positivos":["<item 1>","<item 2>","<item 3>"],"pontos_atencao":["<item 1>","<item 2>"],"proximos_passos":"<1 frase>","cta":"Para análise completa com score, checklist de documentos e planilha de preços, acesse o Conlicit Hub."}\nResponda APENAS com o JSON, sem markdown.`;
  const { data } = await axios.post(ANTHROPIC_URL,{ model:'claude-sonnet-4-20250514', max_tokens:600, temperature:0, messages:[{role:'user',content:prompt}]},{headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},timeout:30000});
  const raw = data.content[0].text.trim();
  try { return JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Resposta inválida'); }
}

async function receberLead(req, res) {
  const { nome, email, whatsapp, empresa, segmento, origem, respostas, numero_pncp, resultado } = req.body ?? {};
  if (!nome?.trim())  return res.status(400).json({ erro: 'Nome é obrigatório' });
  if (!email?.trim()) return res.status(400).json({ erro: 'E-mail é obrigatório' });
  try {
    const notas = notaOrigem(origem, { respostas, numero_pncp, segmento });
    const { rows: [prospect] } = await db.query(`INSERT INTO prospects (nome, email, whatsapp, empresa, segmento, status, notas, responsavel) VALUES ($1, $2, $3, $4, $5, 'em_negociacao', $6, 'Site') ON CONFLICT DO NOTHING RETURNING id, nome, email, created_at`,[nome.trim(), email.trim().toLowerCase(), whatsapp||null, empresa||null, segmento||null, notas]);
    console.log(`[Captação] Novo lead: ${nome} (${email}) via ${origem || 'site'}`);
    return res.status(201).json({ sucesso: true, mensagem: 'Obrigado! Entraremos em contato em breve.', id: prospect?.id || null });
  } catch (e) {
    console.error('[Captação] receberLead:', e.message);
    return res.status(500).json({ erro: 'Erro ao salvar. Tente novamente.' });
  }
}

async function analisarPublico(req, res) {
  const { nome, email, whatsapp, empresa, segmento, numero_pncp, referencia } = req.body ?? {};
  if (!nome?.trim())  return res.status(400).json({ erro: 'Nome é obrigatório' });
  if (!email?.trim()) return res.status(400).json({ erro: 'E-mail é obrigatório' });
  const refEdital = numero_pncp || referencia || 'não informado';
  try {
    const notas = notaOrigem('analisador', { numero_pncp: refEdital, segmento });
    await db.query(`INSERT INTO prospects (nome, email, whatsapp, empresa, segmento, status, notas, responsavel) VALUES ($1, $2, $3, $4, $5, 'em_negociacao', $6, 'Site — Analisador') ON CONFLICT DO NOTHING`,[nome.trim(), email.trim().toLowerCase(), whatsapp||null, empresa||null, segmento||null, notas]);
    let analise;
    try { analise = await gerarAnalisePublica(refEdital, segmento); }
    catch { analise = { resumo:'Não foi possível gerar a análise automática neste momento.', pontos_positivos:['Verifique o edital completo no PNCP','Confira as exigências de habilitação','Analise o valor estimado'], pontos_atencao:['Certidões devem estar válidas na data da sessão','Verifique prazos de entrega e locais'], proximos_passos:'Acesse o Conlicit Hub para a análise completa.', cta:'Para análise completa com score, checklist e planilha de preços, acesse o Conlicit Hub.' }; }
    console.log(`[Captação] Análise pública: ${nome} (${email}) — edital ${refEdital}`);
    return res.status(200).json({ sucesso: true, lead_salvo: true, analise });
  } catch (e) {
    console.error('[Captação] analisarPublico:', e.message);
    return res.status(500).json({ erro: 'Erro ao processar. Tente novamente.' });
  }
}

module.exports = { receberLead, analisarPublico };
