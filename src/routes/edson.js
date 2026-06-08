const express = require('express');
const router = express.Router();
const ctrl         = require('../controllers/edsonController');
const planilhaCtrl = require('../controllers/edsonPlanilhaController');

router.get('/',                                                      ctrl.listar);
// avulso deve vir antes de /:pregao_id para não ser capturado como param
router.post('/avulso', ctrl.upload.single('edital'),                 ctrl.avulso);
router.get('/analise/:analise_id',                                   ctrl.obterPorId);
router.get('/analise/:analise_id/chat',                              ctrl.getChatHistoricoPorId);
router.post('/analise/:analise_id/chat',                             ctrl.chatPorId);
router.post('/analise/:analise_id/upload-pdf',          ctrl.upload.single('edital'),                ctrl.uploadPDFAvulso);
router.post('/analise/:analise_id/upload-imagem',       ctrl.uploadImagemMulter.single('imagem'),    ctrl.uploadImagemPNCP);
router.post('/analise/:analise_id/upload-complementar', ctrl.upload.single('arquivo'),               ctrl.uploadComplementar);
router.patch('/analise/:analise_id/revisao',                         ctrl.revisaoAnalise);
router.patch('/analise/:analise_id/vincular',                        ctrl.vincularCliente);
router.delete('/analise/:analise_id',                                ctrl.descartarAnalise);
router.get('/analise/:analise_id/relatorio-simples',                 ctrl.relatorioSimplesAvulso);
router.get('/analise/:analise_id/planilha',                          ctrl.planilhaAvulso);
router.get('/analise/:analise_id/relatorio',                         ctrl.relatorioAvulso);
// ── Planilha de Preços (Edson) ────────────────────────────────────────────────
router.get( '/analise/:analise_id/planilha-precos',                  planilhaCtrl.obterEstado);
router.post('/analise/:analise_id/planilha-precos/itens-edital',     planilhaCtrl.extrairItens);
router.post('/analise/:analise_id/planilha-precos/selecao',          planilhaCtrl.salvarSelecao);
router.post('/analise/:analise_id/planilha-precos/pesquisar',        planilhaCtrl.pesquisarPrecos);
router.post('/analise/:analise_id/planilha-precos/gerar-csv',        planilhaCtrl.gerarCSV);

router.post('/:pregao_id',                                           ctrl.disparar);
router.post('/:pregao_id/upload-pdf', ctrl.upload.single('edital'),  ctrl.uploadPDF);
router.get('/:pregao_id/planilha',                                   ctrl.planilha);
router.get('/:pregao_id/relatorio',                                  ctrl.relatorio);
router.get('/:pregao_id/relatorio-simples',                          ctrl.relatorioSimples);
router.get('/:pregao_id/chat',                                       ctrl.getChatHistorico);
router.post('/:pregao_id/chat',                                      ctrl.chat);
router.get('/:pregao_id',                                            ctrl.obter);

module.exports = router;
