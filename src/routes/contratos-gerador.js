const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

// GET /api/contratos-gerador — listar contratos do usuário
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, nome_cliente, cnpj_cpf, plano, data_inicio,
              prazo_meses, honorario_mensal, criado_em, atualizado_em
       FROM contratos_gerados
       WHERE criado_por = $1
       ORDER BY atualizado_em DESC`,
      [req.usuario.id],
    );
    res.json(rows);
  } catch (err) {
    console.error('[contratos-gerador] GET:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar contratos.' });
  }
});

// GET /api/contratos-gerador/:id — contrato completo
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM contratos_gerados WHERE id = $1 AND criado_por = $2',
      [req.params.id, req.usuario.id],
    );
    if (!rows.length) return res.status(404).json({ erro: 'Não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[contratos-gerador] GET/:id:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar contrato.' });
  }
});

// POST /api/contratos-gerador — criar contrato
router.post('/', async (req, res) => {
  try {
    const {
      nome_cliente, cnpj_cpf, telefone, endereco, representante, cargo, email,
      data_inicio, prazo_meses, plano, modalidades, segmentos, abrangencia,
      honorario_mensal, dia_vencimento, comissao_exitop, prazo_exito_dias,
      forma_pagamento, multa_rescisoria, observacoes, servicos,
    } = req.body;

    const { rows } = await db.query(
      `INSERT INTO contratos_gerados (
         nome_cliente, cnpj_cpf, telefone, endereco, representante, cargo, email,
         data_inicio, prazo_meses, plano, modalidades, segmentos, abrangencia,
         honorario_mensal, dia_vencimento, comissao_exitop, prazo_exito_dias,
         forma_pagamento, multa_rescisoria, observacoes, servicos, criado_por
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        nome_cliente, cnpj_cpf, telefone, endereco, representante, cargo, email,
        data_inicio || null, prazo_meses || null, plano, modalidades, segmentos, abrangencia,
        honorario_mensal, dia_vencimento || null, comissao_exitop, prazo_exito_dias || null,
        forma_pagamento, multa_rescisoria, observacoes,
        JSON.stringify(servicos || []), req.usuario.id,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[contratos-gerador] POST:', err.message);
    res.status(500).json({ erro: 'Erro ao criar contrato.' });
  }
});

// PUT /api/contratos-gerador/:id — atualizar contrato
router.put('/:id', async (req, res) => {
  try {
    const {
      nome_cliente, cnpj_cpf, telefone, endereco, representante, cargo, email,
      data_inicio, prazo_meses, plano, modalidades, segmentos, abrangencia,
      honorario_mensal, dia_vencimento, comissao_exitop, prazo_exito_dias,
      forma_pagamento, multa_rescisoria, observacoes, servicos,
    } = req.body;

    const { rows } = await db.query(
      `UPDATE contratos_gerados SET
         nome_cliente=$1, cnpj_cpf=$2, telefone=$3, endereco=$4,
         representante=$5, cargo=$6, email=$7, data_inicio=$8,
         prazo_meses=$9, plano=$10, modalidades=$11, segmentos=$12,
         abrangencia=$13, honorario_mensal=$14, dia_vencimento=$15,
         comissao_exitop=$16, prazo_exito_dias=$17, forma_pagamento=$18,
         multa_rescisoria=$19, observacoes=$20, servicos=$21, atualizado_em=NOW()
       WHERE id=$22 AND criado_por=$23
       RETURNING *`,
      [
        nome_cliente, cnpj_cpf, telefone, endereco, representante, cargo, email,
        data_inicio || null, prazo_meses || null, plano, modalidades, segmentos, abrangencia,
        honorario_mensal, dia_vencimento || null, comissao_exitop, prazo_exito_dias || null,
        forma_pagamento, multa_rescisoria, observacoes,
        JSON.stringify(servicos || []),
        req.params.id, req.usuario.id,
      ],
    );
    if (!rows.length) return res.status(404).json({ erro: 'Não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[contratos-gerador] PUT:', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar contrato.' });
  }
});

// DELETE /api/contratos-gerador/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM contratos_gerados WHERE id=$1 AND criado_por=$2',
      [req.params.id, req.usuario.id],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[contratos-gerador] DELETE:', err.message);
    res.status(500).json({ erro: 'Erro ao excluir contrato.' });
  }
});

module.exports = router;
