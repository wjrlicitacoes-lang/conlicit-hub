const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/edsonController');

router.get('/',                                                      ctrl.listar);
// avulso deve vir antes de /:pregao_id para não ser capturado como param
router.post('/avulso', ctrl.upload.single('edital'),                 ctrl.avulso);
router.get('/analise/:analise_id',                                   ctrl.obterPorId);
router.get('/analise/:analise_id/chat',                              ctrl.getChatHistoricoPorId);
router.post('/analise/:analise_id/chat',                             ctrl.chatPorId);
router.patch('/analise/:analise_id/vincular',                        ctrl.vincularCliente);
router.delete('/analise/:analise_id',                                ctrl.descartarAnalise);
router.post('/:pregao_id',                                           ctrl.disparar);
router.post('/:pregao_id/upload-pdf', ctrl.upload.single('edital'),  ctrl.uploadPDF);
router.get('/:pregao_id/planilha',                                   ctrl.planilha);
router.get('/:pregao_id/relatorio',                                  ctrl.relatorio);
router.get('/:pregao_id/relatorio-simples',                          ctrl.relatorioSimples);
router.get('/:pregao_id/chat',                                       ctrl.getChatHistorico);
router.post('/:pregao_id/chat',                                      ctrl.chat);
router.get('/:pregao_id',                                            ctrl.obter);

module.exports = router;
