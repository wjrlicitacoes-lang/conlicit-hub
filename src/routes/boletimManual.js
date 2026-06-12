'use strict';
const express = require('express');
const router  = express.Router();
const { triar, gerarHtml, disparar } = require('../controllers/boletimManualController');
const {
  listarFila, adicionarFila, atualizarCliente, descartarFila, gerarBoletimDaFila,
  listarInteressesCliente, atualizarInteresse, converterPregao, listarHistorico,
} = require('../controllers/boletimFilaController');

// Workflow manual existente
router.post('/triar',      triar);
router.post('/gerar-html', gerarHtml);
router.post('/disparar',   disparar);

// Fila de boletins
router.get('/fila',                      listarFila);
router.post('/fila',                     adicionarFila);
router.post('/fila/gerar',               gerarBoletimDaFila);
router.patch('/fila/:id/cliente',        atualizarCliente);
router.delete('/fila/:id',               descartarFila);

// Interesses (protegidos — a rota pública /interesse está em app.js)
router.get('/interesses/:cliente_id',    listarInteressesCliente);
router.patch('/interesses/:id',          atualizarInteresse);
router.post('/interesses/:id/pregao',    converterPregao);

// Histórico de boletins
router.get('/historico',                 listarHistorico);

module.exports = router;
