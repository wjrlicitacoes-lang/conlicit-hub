const express    = require('express');
const db         = require('../database/db');
const autenticar = require('../middleware/autenticar');

const router = express.Router();
router.use(autenticar);

// POST /propostas-readequadas/gerar
// Body: { pregao_id, cliente_id, itens: [{numero, descricao, unidade, quantidade, valor_unitario, valor_total, marca}], valor_total_geral, prazo_validade? }
router.post('/gerar', async (req, res) => {
  const { pregao_id, cliente_id, itens = [], valor_total_geral, prazo_validade = 90 } = req.body ?? {};

  if (!cliente_id || !pregao_id) return res.status(400).json({ erro: 'cliente_id e pregao_id são obrigatórios' });
  if (!itens.length)              return res.status(400).json({ erro: 'itens não pode ser vazio' });

  try {
    const { rows: [cliente] } = await db.query(
      `SELECT nome, razao_social, cnpj, responsavel_legal, cargo_responsavel, cpf_responsavel, endereco, whatsapp, email, logo_base64
       FROM clientes WHERE id = $1`,
      [cliente_id],
    );
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' });

    const { rows: [pregao] } = await db.query(
      `SELECT numero, orgao, objeto FROM pregoes WHERE id = $1`,
      [pregao_id],
    );
    if (!pregao) return res.status(404).json({ erro: 'Pregão não encontrado' });

    const nomeSocial = cliente.razao_social || cliente.nome;

    // Formatar valor total
    const fmtBRL = (v) => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Linhas da tabela de itens
    const linhasItens = itens.map(i => `
      <tr>
        <td style="border:1px solid #ccc;padding:6px;text-align:center">${i.numero || ''}</td>
        <td style="border:1px solid #ccc;padding:6px">${i.descricao || ''}</td>
        <td style="border:1px solid #ccc;padding:6px;text-align:center">${i.unidade || ''}</td>
        <td style="border:1px solid #ccc;padding:6px;text-align:center">${i.marca || ''}</td>
        <td style="border:1px solid #ccc;padding:6px;text-align:right">${fmtBRL(i.quantidade)}</td>
        <td style="border:1px solid #ccc;padding:6px;text-align:right">R$ ${fmtBRL(i.valor_unitario)}</td>
        <td style="border:1px solid #ccc;padding:6px;text-align:right">R$ ${fmtBRL(i.valor_total)}</td>
      </tr>`).join('');

    const logoHtml = cliente.logo_base64
      ? `<img src="${cliente.logo_base64}" style="max-height:60px;max-width:200px;" />`
      : `<strong style="font-size:22px">${nomeSocial}</strong>`;

    const contatoHtml = [
      cliente.whatsapp ? `(${cliente.whatsapp.slice(2,4)}) ${cliente.whatsapp.slice(4,9)}-${cliente.whatsapp.slice(9)}` : '',
      cliente.email || '',
      cliente.endereco || '',
    ].filter(Boolean).join(' &nbsp;|&nbsp; ');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #222; margin: 0; }
  .page { max-width: 900px; margin: 0 auto; padding: 24px; }
  .header { background:#C0392B; color:white; padding:16px 24px; display:flex; align-items:center; justify-content:space-between; }
  .header-logo { }
  .header-contact { font-size:11px; text-align:right; }
  h1 { text-align:center; font-size:18px; margin:24px 0 16px; text-transform:uppercase; }
  h2 { font-size:14px; color:#C0392B; margin-top:20px; }
  table { width:100%; border-collapse:collapse; margin:12px 0; }
  th { background:#f0f0f0; border:1px solid #ccc; padding:6px; text-align:center; font-size:11px; }
  .total-row td { font-weight:bold; background:#fff8f8; }
  .footer { background:#C0392B; color:white; padding:8px 24px; font-size:11px; text-align:center; margin-top:32px; }
  .assinatura { margin-top:40px; text-align:center; }
  .assinatura hr { width:300px; border:1px solid #333; }
  @media print { .page { padding: 0; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-logo">${logoHtml}</div>
    <div class="header-contact">${contatoHtml}</div>
  </div>

  <h1>Proposta Comercial Readequada</h1>

  <p><strong>Órgão:</strong> ${pregao.orgao || '—'}</p>
  <p><strong>Processo licitatório Nº:</strong> ${pregao.numero || '—'}</p>
  <p><strong>Pregão eletrônico Nº:</strong> ${pregao.numero || '—'}</p>

  <p>Att. Pregoeiro(a) e/ou Equipe de Apoio</p>
  <p>Apresentamos nossa proposta readequada ao lance final para os itens abaixo:</p>

  <table>
    <thead>
      <tr>
        <th>Item</th><th>Descrição</th><th>Unidade</th><th>Marca</th>
        <th>Quantitativo</th><th>Valor unitário</th><th>Valor final</th>
      </tr>
    </thead>
    <tbody>
      ${linhasItens}
    </tbody>
  </table>

  <p style="margin-top:16px">
    <strong>Valor total da proposta: R$ ${fmtBRL(valor_total_geral)}</strong>
  </p>
  <p><strong>Prazo de Validade da Proposta:</strong> ${prazo_validade} dias</p>
  <p style="font-size:11px;color:#666;margin-top:8px">
    O catálogo detalhado dos itens, marcas ofertadas e demais informações encontra-se no documento anexo, parte integrante desta proposta.
  </p>

  <div class="assinatura">
    <p>[Local], [Data]</p>
    <br><br>
    <hr />
    <p><strong>${cliente.responsavel_legal || nomeSocial}</strong>${cliente.cpf_responsavel ? ` (CPF: ${cliente.cpf_responsavel})` : ''}</p>
    <p>${cliente.cargo_responsavel || 'Representante Legal'} – ${nomeSocial}</p>
    ${cliente.cnpj ? `<p>CNPJ ${cliente.cnpj}</p>` : ''}
  </div>

  <div class="footer">${contatoHtml || nomeSocial}</div>
</div>
</body>
</html>`;

    return res.json({ sucesso: true, html, cliente: { nome: nomeSocial, logo: !!cliente.logo_base64 } });
  } catch (e) {
    console.error('[PropostasReadequadas] gerar:', e.message);
    return res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
