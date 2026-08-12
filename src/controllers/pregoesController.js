const db = require('../database/db');
const { salvarDocumento, dispararEdsonSeNecessario } = require('./pregaoDocumentosController');

async function listar(req, res) {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM pregoes WHERE cliente_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (erro) {
    console.error('Erro ao listar pregões:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function inserirPregao(clienteId, dados) {
  const { numero, orgao, objeto, data_abertura, valor_estimado, status,
          data_hora_abertura, operador_id, numero_controle_pncp, link_pncp, portal_disputa,
          valor_minimo_lance } = dados ?? {};

  if (!numero) throw Object.assign(new Error('numero é obrigatório'), { status: 400 });

  const { rows } = await db.query(
    `INSERT INTO pregoes
       (cliente_id, numero, orgao, objeto, data_abertura, valor_estimado, status,
        data_hora_abertura, operador_id, numero_controle_pncp, link_pncp, portal_disputa, valor_minimo_lance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [clienteId, numero, orgao || null, objeto || null,
     data_abertura || null, parseFloat(valor_estimado) || null,
     status || 'a_disputar',
     data_hora_abertura || null,
     operador_id ? parseInt(operador_id) : null,
     numero_controle_pncp?.trim() || null,
     link_pncp?.trim() || null,
     portal_disputa?.trim() || null,
     parseFloat(valor_minimo_lance) || null],
  );
  return rows[0];
}

async function criar(req, res) {
  if (req.usuario?.role === 'cliente') return res.status(403).json({ erro: 'Acesso negado' });
  const { id } = req.params;
  try {
    const pregao = await inserirPregao(id, req.body);

    if (req.file) {
      const { hash } = await salvarDocumento(pregao.id, 'edital', req.file, req.usuario?.id);
      if (String(req.body?.acionar_edson) === 'true') {
        dispararEdsonSeNecessario(pregao.id, hash, req.file.buffer).catch(console.error);
      }
    }

    return res.status(201).json(pregao);
  } catch (erro) {
    if (erro.status) return res.status(erro.status).json({ erro: erro.message });
    console.error('Erro ao criar pregão:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function atualizar(req, res) {
  const { id, pid } = req.params;
  const { status, valor_vencido, comissao_gerada, numero, orgao, objeto, data_abertura, valor_estimado,
          data_hora_abertura, operador_id, numero_controle_pncp, link_pncp, portal_disputa,
          contrato_assinado, valor_minimo_lance, motivo_perda, menor_preco_concorrente, monitorar_resultado,
          operador_obs, itens_lotes, motivo } = req.body ?? {};

  const campos = [];
  const valores = [];
  let idx = 1;

  // sempre atualiza updated_at quando qualquer campo muda
  campos.push(`updated_at = NOW()`);

  if (status          !== undefined) { campos.push(`status = $${idx++}`);          valores.push(status); }
  if (valor_vencido   !== undefined) { campos.push(`valor_vencido = $${idx++}`);   valores.push(parseFloat(valor_vencido) || null); }
  if (comissao_gerada !== undefined) { campos.push(`comissao_gerada = $${idx++}`); valores.push(parseFloat(comissao_gerada) || null); }
  if (numero          !== undefined) { campos.push(`numero = $${idx++}`);          valores.push(numero); }
  if (orgao           !== undefined) { campos.push(`orgao = $${idx++}`);           valores.push(orgao); }
  if (objeto          !== undefined) { campos.push(`objeto = $${idx++}`);          valores.push(objeto); }
  if (data_abertura       !== undefined) { campos.push(`data_abertura = $${idx++}`);       valores.push(data_abertura || null); }
  if (valor_estimado      !== undefined) { campos.push(`valor_estimado = $${idx++}`);      valores.push(parseFloat(valor_estimado) || null); }
  if (data_hora_abertura  !== undefined) {
    campos.push(`data_hora_abertura = $${idx++}`);
    valores.push(data_hora_abertura || null);
    // Reset alert flags so alerts fire again at the new time
    campos.push(`alerta_vespera_enviado = FALSE`);
    campos.push(`alerta_2h_enviado = FALSE`);
    campos.push(`alerta_1h_enviado = FALSE`);
  }
  if (operador_id           !== undefined) { campos.push(`operador_id = $${idx++}`);           valores.push(operador_id ? parseInt(operador_id) : null); }
  if (numero_controle_pncp !== undefined) { campos.push(`numero_controle_pncp = $${idx++}`); valores.push(numero_controle_pncp?.trim() || null); }
  if (link_pncp            !== undefined) { campos.push(`link_pncp = $${idx++}`);            valores.push(link_pncp?.trim() || null); }
  if (portal_disputa       !== undefined) { campos.push(`portal_disputa = $${idx++}`);       valores.push(portal_disputa?.trim() || null); }
  if (contrato_assinado    !== undefined) { campos.push(`contrato_assinado = $${idx++}`);    valores.push(Boolean(contrato_assinado)); }
  if (valor_minimo_lance    !== undefined) { campos.push(`valor_minimo_lance = $${idx++}`);    valores.push(parseFloat(valor_minimo_lance) || null); }
  if (motivo_perda          !== undefined) { campos.push(`motivo_perda = $${idx++}`);          valores.push(motivo_perda || null); }
  if (menor_preco_concorrente !== undefined) { campos.push(`menor_preco_concorrente = $${idx++}`); valores.push(parseFloat(menor_preco_concorrente) || null); }
  if (monitorar_resultado   !== undefined) { campos.push(`monitorar_resultado = $${idx++}`);   valores.push(Boolean(monitorar_resultado)); }
  if (operador_obs          !== undefined) { campos.push(`operador_obs = $${idx++}`);           valores.push(operador_obs?.trim() || null); }
  if (itens_lotes           !== undefined) { campos.push(`itens_lotes = $${idx++}`);            valores.push(JSON.stringify(Array.isArray(itens_lotes) ? itens_lotes : [])); }

  if (campos.length === 0) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });

  valores.push(pid);
  valores.push(id);
  try {
    const statusAnterior = status !== undefined
      ? (await db.query('SELECT status FROM pregoes WHERE id = $1 AND cliente_id = $2', [pid, id])).rows[0]?.status
      : null;

    const { rows } = await db.query(
      `UPDATE pregoes SET ${campos.join(', ')} WHERE id = $${idx++} AND cliente_id = $${idx++} RETURNING *`,
      valores,
    );
    if (rows.length === 0) return res.status(404).json({ erro: 'Pregão não encontrado' });

    if (status !== undefined && statusAnterior !== undefined && statusAnterior !== status) {
      await db.query(
        `INSERT INTO pregao_historico_status (pregao_id, status_anterior, status_novo, motivo, alterado_por)
         VALUES ($1,$2,$3,$4,$5)`,
        [pid, statusAnterior, status, motivo || null, req.usuario?.id || null],
      );
    }

    return res.json(rows[0]);
  } catch (erro) {
    console.error('Erro ao atualizar pregão:', erro);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

async function remover(req, res) {
  if (req.usuario?.role === 'cliente') return res.status(403).json({ erro: 'Acesso negado' });
  const { id, pid } = req.params;
  try {
    const { rowCount } = await db.query(
      'DELETE FROM pregoes WHERE id = $1 AND cliente_id = $2',
      [pid, id],
    );
    if (rowCount === 0) return res.status(404).json({ erro: 'Pregão não encontrado' });
    return res.json({ mensagem: 'Pregão removido com sucesso' });
  } catch (erro) {
    console.error('Erro ao remover pregão:', erro);
    return res.status(500).json({ erro: 'Erro ao remover pregão' });
  }
}

async function listarTodos(req, res) {
  if (req.usuario?.role === 'cliente') return res.status(403).json({ erro: 'Acesso negado' });
  const { status, cliente_id } = req.query;
  const { role, id: userId } = req.usuario;
  try {
    const conds = [];
    const vals = [];
    let idx = 1;
    if (status)     { conds.push(`p.status = $${idx++}`);     vals.push(status); }
    if (cliente_id) { conds.push(`p.cliente_id = $${idx++}`); vals.push(parseInt(cliente_id, 10)); }

    if (!['admin', 'socio_fundador', 'diretor_comercial'].includes(role)) {
      conds.push(`p.operador_id = $${idx++}`);
      vals.push(userId);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT p.*, c.nome AS cliente_nome
       FROM pregoes p
       JOIN clientes c ON c.id = p.cliente_id
       ${where}
       ORDER BY p.data_hora_abertura DESC NULLS LAST, p.created_at DESC
       LIMIT 200`,
      vals,
    );
    return res.json({ total: rows.length, dados: rows });
  } catch (e) {
    console.error('Erro ao listar todos os pregões:', e.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}

// CSV esperado: numero,orgao,objeto,plataforma,valor_minimo,data_abertura,cliente_id
// (cliente_id da linha tem prioridade; se ausente, usa req.body.cliente_id padrão)
async function importarCSV(req, res) {
  if (req.usuario?.role === 'cliente') return res.status(403).json({ erro: 'Acesso negado' });
  if (!req.file) return res.status(400).json({ erro: 'Arquivo CSV obrigatório (campo: arquivo)' });

  const { parse } = require('csv-parse/sync');
  const clienteIdPadrao = req.body?.cliente_id ? parseInt(req.body.cliente_id, 10) : null;

  let linhas;
  try {
    linhas = parse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ erro: `CSV inválido: ${e.message}` });
  }

  const criados = [];
  const erros = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const clienteId = linha.cliente_id ? parseInt(linha.cliente_id, 10) : clienteIdPadrao;
    if (!clienteId) { erros.push({ linha: i + 2, erro: 'cliente_id não informado' }); continue; }
    try {
      const pregao = await inserirPregao(clienteId, {
        numero: linha.numero,
        orgao: linha.orgao,
        objeto: linha.objeto,
        portal_disputa: linha.plataforma || linha.portal_disputa,
        valor_minimo_lance: linha.valor_minimo || linha.valor_minimo_lance,
        data_abertura: linha.data_abertura || null,
      });
      criados.push(pregao);
    } catch (e) {
      erros.push({ linha: i + 2, erro: e.message });
    }
  }

  return res.json({ total_linhas: linhas.length, criados: criados.length, erros, dados: criados });
}

module.exports = { listar, criar, atualizar, remover, listarTodos, importarCSV };
