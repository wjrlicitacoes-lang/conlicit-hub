'use strict';

const NICHOS = [
  'Saúde / Medicamentos',
  'Limpeza e Conservação',
  'Obras / Engenharia',
  'TI / Software',
  'Segurança / Vigilância',
  'Transporte / Frota',
  'Alimentação / Merenda',
  'EPI / Equipamentos',
  'Manutenção Predial',
  'Saneamento / Ambiental',
];

// ─────────────────────────────────────────────────────────────
// LinkedIn — 4 tipos × "geral" + templates niche-specific onde relevante
// ─────────────────────────────────────────────────────────────
const LINKEDIN_TEMPLATES = [
  // TIPO 1 — Educativo (geral — funciona para qualquer nicho)
  {
    canal: 'linkedin', tipo: 'post', nicho: 'geral',
    titulo: 'Por que editais ficam desertos no PNCP?',
    conteudo: `Toda semana, dezenas de licitações são publicadas no PNCP — e ficam sem nenhuma proposta.

O motivo quase sempre é o mesmo: as empresas não monitoram, não chegam a tempo, ou não entendem o que o edital exige.

O que acontece depois?
→ O órgão pode contratar por dispensa de licitação
→ Com quem? Com a empresa que estava monitorando o edital

Se a sua empresa fornece para o governo (ou quer fornrecer), esses editais são oportunidade de venda direta — sem pregão, sem disputa de preço.

No Conlicit, você recebe um alerta assim que esse tipo de edital abre — com resumo completo do que precisa para participar.

Quer ver como funciona? Link na bio 👇
conlicit.com/analise-gratuita`,
    hashtags: '#licitacoes #pregaoeletronico #fornecedorpublico #PNCP #lei14133 #conlicit',
    cta_texto: 'Análise gratuita de edital',
    cta_link: 'https://conlicit.com/analise-gratuita',
    imagem_desc: 'Arte com fundo escuro #182A39, texto "35% dos editais ficam desertos" em destaque com cor #4CC5D7. Logo Conlicit no canto.',
  },
  // Educativo — Saúde
  {
    canal: 'linkedin', tipo: 'post', nicho: 'Saúde / Medicamentos',
    titulo: 'Por que 35% dos editais de medicamentos ficam desertos no PNCP?',
    conteudo: `Toda semana, dezenas de licitações de medicamentos especiais são publicadas em Minas Gerais — e ficam sem nenhuma proposta.

O motivo quase sempre é o mesmo: o preço de referência do SIGTAP está desatualizado. O edital abre, nenhuma distribuidora consegue cobrir o custo com aquele teto, e o certame fracassa.

O que acontece depois?
→ O órgão pode contratar por dispensa de licitação
→ Com quem? Com a empresa que estava monitorando o edital

Se a sua distribuidora atua em BH ou RMBH, esses editais são oportunidade de venda direta ao governo — sem pregão, sem disputa de preço.

No Conlicit, você recebe um alerta assim que esse tipo de edital abre (ou reabre) — com resumo completo do que precisa para participar.

Quer ver como funciona? Link na bio 👇
conlicit.com/analise-gratuita`,
    hashtags: '#licitacoes #medicamentos #PNCP #lei14133 #fornecedorpublico #SUS #conlicit',
    cta_texto: 'Análise gratuita de edital',
    cta_link: 'https://conlicit.com/analise-gratuita',
    imagem_desc: 'Arte com fundo escuro, ícone de medicamento, texto "35% dos editais de medicamentos ficam desertos" em destaque. Logo Conlicit.',
  },
  // TIPO 2 — Prova social
  {
    canal: 'linkedin', tipo: 'post', nicho: 'geral',
    titulo: 'Contrato assinado sem concorrentes',
    conteudo: `Uma empresa de [nicho] de [cidade] ganhou um contrato de R$ [valor] com a Prefeitura de [município] — e o edital ficou sem concorrentes.

Eles foram os únicos a apresentar proposta porque estavam monitorando o PNCP com o Conlicit.

Resultado: contrato assinado sem disputa de preço.

Esse é o poder de chegar primeiro.`,
    hashtags: '#licitacoes #pregaoeletronico #fornecedorpublico #PNCP #conlicit #casesucesso',
    cta_texto: 'Teste grátis',
    cta_link: 'https://conlicit.com/analise-gratuita',
    imagem_desc: 'Arte clean com ícone de troféu e texto "Contrato sem concorrentes". Logo Conlicit. Fundo #182A39.',
  },
  // TIPO 3 — Dado + CTA
  {
    canal: 'linkedin', tipo: 'post', nicho: 'geral',
    titulo: 'R$ 272 bilhões para micro e pequenas empresas em 2025',
    conteudo: `Em 2025, o PNCP registrou mais de 1 milhão de compras públicas.
R$ 272 bilhões foram para micro e pequenas empresas.

Sua empresa está disputando parte desse mercado — ou perdendo para quem está monitorando melhor?

Analise seu próximo edital de graça 👇
conlicit.com/analise-gratuita`,
    hashtags: '#licitacoes #MPE #pregaoeletronico #PNCP #fornecedorpublico #conlicit',
    cta_texto: 'Análise gratuita',
    cta_link: 'https://conlicit.com/analise-gratuita',
    imagem_desc: 'Arte com número "R$ 272 bilhões" em destaque, subtítulo "para MPEs em 2025". Fundo escuro. Logo Conlicit.',
  },
  // TIPO 4 — Pergunta (engajamento)
  {
    canal: 'linkedin', tipo: 'post', nicho: 'geral',
    titulo: 'Qual é o maior problema para participar de licitações?',
    conteudo: `Qual é o maior problema da sua empresa para participar de licitações?

A) Não encontro os editais do meu nicho
B) Perco muito tempo lendo o edital completo
C) Não sei se minha empresa está habilitada
D) Perco os prazos

Comentem — isso vai virar funcionalidade do Conlicit 👇`,
    hashtags: '#licitacoes #pregaoeletronico #fornecedorpublico #PNCP #conlicit #enquete',
    cta_texto: 'Comente sua resposta',
    cta_link: null,
    imagem_desc: 'Arte com fundo azul escuro, 4 opções A/B/C/D em cards. Logo Conlicit. Texto pergunta em destaque.',
  },
  // Educativo — Limpeza
  {
    canal: 'linkedin', tipo: 'post', nicho: 'Limpeza e Conservação',
    titulo: 'Editais de limpeza em MG: oportunidade ignorada pelas PMEs',
    conteudo: `Só em BH e RMBH, saem centenas de editais de limpeza e conservação por mês no PNCP.

A maioria das PMEs do setor nem sabe que eles existem.

Por quê? Porque monitorar o PNCP todo dia exige tempo que o dono da empresa não tem.

O Conlicit monitora isso automaticamente — envia os editais do seu nicho com resumo completo, prazo e exigências.

Você chega primeiro. Você apresenta proposta. Você fecha contrato.

Análise gratuita → conlicit.com/analise-gratuita`,
    hashtags: '#licitacoes #limpeza #conservacao #PNCP #pregaoeletronico #fornecedorpublico #conlicit',
    cta_texto: 'Análise gratuita de edital',
    cta_link: 'https://conlicit.com/analise-gratuita',
    imagem_desc: 'Arte com ícone de limpeza/vassoura, fundo escuro, texto "Centenas de editais de limpeza — você está perdendo?" em destaque.',
  },
  // Educativo — Segurança
  {
    canal: 'linkedin', tipo: 'post', nicho: 'Segurança / Vigilância',
    titulo: 'Contratos de vigilância pública: como entrar nesse mercado',
    conteudo: `Hospitais, prefeituras, autarquias — o governo é o maior contratante de serviços de segurança do Brasil.

E a maioria dos contratos passa por pregão eletrônico no PNCP.

O problema: monitorar todos esses editais no seu nicho e região exige atenção constante.

O Conlicit faz isso automaticamente para empresas de vigilância — alerta diário, resumo completo, controle de prazos.

Quer ver um exemplo real de edital do seu nicho?
→ conlicit.com/analise-gratuita`,
    hashtags: '#licitacoes #vigilancia #segurancapatriomonial #PNCP #pregaoeletronico #conlicit',
    cta_texto: 'Ver exemplo de edital',
    cta_link: 'https://conlicit.com/analise-gratuita',
    imagem_desc: 'Arte com ícone de escudo/segurança, fundo escuro, texto "O governo é o maior contratante de vigilância" em destaque.',
  },
  // Educativo — TI
  {
    canal: 'linkedin', tipo: 'post', nicho: 'TI / Software',
    titulo: 'Governo digital: como empresas de TI vendem para o poder público',
    conteudo: `A transformação digital do governo criou um mercado bilionário para empresas de TI.

Sistemas, licenças, suporte, infraestrutura — tudo contratado via licitação pública no PNCP.

O desafio: encontrar os editais certos no seu nicho (software de gestão? cybersecurity? cloud?).

O Conlicit monitora o PNCP por palavras-chave do seu segmento e envia alertas diários com resumo.

Análise gratuita de edital → conlicit.com/analise-gratuita`,
    hashtags: '#licitacoes #TI #software #govtech #PNCP #pregaoeletronico #conlicit',
    cta_texto: 'Análise gratuita',
    cta_link: 'https://conlicit.com/analise-gratuita',
    imagem_desc: 'Arte tech com ícones de código/servidor, fundo escuro, texto "Governo digital: oportunidade para empresas de TI" em destaque.',
  },
];

// ─────────────────────────────────────────────────────────────
// Instagram
// ─────────────────────────────────────────────────────────────
const INSTAGRAM_TEMPLATES = [
  // CARROSSEL 1
  {
    canal: 'instagram', tipo: 'carrossel', nicho: 'geral',
    titulo: '5 sinais que sua empresa está perdendo licitações',
    conteudo: `SLIDE 1 (CAPA): "5 sinais que sua empresa está PERDENDO licitações 🚨"

SLIDE 2: "Você só descobre o edital depois que o prazo fechou"
→ Arte: relógio com X vermelho. Texto explicativo: "A maioria das licitações fecha em 5-10 dias úteis. Sem monitoramento diário, você sempre chega tarde."

SLIDE 3: "Lê 80 páginas de edital pra descobrir que não se qualifica"
→ Arte: pilha de documentos. Texto: "O Conlicit resume as exigências de habilitação em menos de 2 minutos com IA."

SLIDE 4: "Perde a sessão porque esqueceu a data no calendário"
→ Arte: calendário com alerta. Texto: "Controle de prazos automático — nunca mais perca uma sessão."

SLIDE 5: "Não sabe quais documentos de habilitação são exigidos"
→ Arte: lista de documentos. Texto: "O Edson IA identifica todos os documentos e certidões necessários."

SLIDE 6: "Desiste de participar porque parece complicado demais"
→ Arte: pessoa sobrecarregada. Texto: "O Conlicit simplifica cada etapa — da busca até a proposta."

SLIDE 7: "Resultado: seus concorrentes ganham contratos que poderiam ser seus"
→ Arte: competidores na frente. Texto chamativo em vermelho.

SLIDE 8: "O Conlicit resolve os 5:"
→ Arte: lista com checkmarks. Monitor + Edson IA + Calendário + Extensão Chrome + Boletim.

SLIDE 9: "Monitor + Edson IA + Calendário + Extensão Chrome"
→ Arte: screenshots dos produtos Conlicit.

SLIDE 10 (CTA): "Analise seu próximo edital de graça → link na bio"
→ Arte: fundo escuro, texto CTA em #4CC5D7. Logo Conlicit.`,
    hashtags: '#licitacoes #pregaoeletronico #fornecedorpublico #PNCP #dicas #empreendedorismo #MPE #conlicit',
    cta_texto: 'Link na bio → análise gratuita',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=instagram&utm_medium=bio&utm_campaign=carrossel',
    imagem_desc: 'Carrossel 10 slides. Capa: fundo escuro #182A39, título em branco, ícone de alerta vermelho. Slides 2-9: fundo branco/cinza claro, ícones coloridos. Slide 10: fundo escuro, botão CTA ciano.',
  },
  // CARROSSEL 2
  {
    canal: 'instagram', tipo: 'carrossel', nicho: 'geral',
    titulo: 'Como funciona uma licitação em 5 passos simples',
    conteudo: `SLIDE 1 (CAPA): "Sua empresa pode vender para o governo. Veja como 👇"

SLIDE 2: "Passo 1: O governo publica o edital no PNCP"
→ O órgão define o que precisa comprar, o prazo e o preço máximo. Tudo fica público.

SLIDE 3: "Passo 2: Empresas baixam o edital e analisam"
→ É aqui que o Conlicit ajuda: resumo automático das exigências em 2 minutos.

SLIDE 4: "Passo 3: Empresas enviam proposta com preço"
→ Tudo online, pelo portal do governo. Sua empresa compete com outras.

SLIDE 5: "Passo 4: Disputa de preços (leilão reverso)"
→ A empresa com o menor preço (dentro dos requisitos) vence.

SLIDE 6: "Passo 5: Contrato assinado e pagamento garantido"
→ O governo tem obrigação legal de pagar. É o cliente mais seguro que existe.

SLIDE 7: "O problema: monitorar, analisar e não perder prazo é trabalhoso"
→ São centenas de editais por dia no PNCP. Impossível acompanhar sozinho.

SLIDE 8: "É exatamente isso que o Conlicit faz por você"

SLIDE 9: "Automaticamente, todo dia, no seu nicho e região"

SLIDE 10 (CTA): "Teste grátis → link na bio"`,
    hashtags: '#licitacoes #comoparticipar #pregaoeletronico #PNCP #empreendedorismo #MPE #fornecedorpublico #conlicit',
    cta_texto: 'Teste grátis — link na bio',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=instagram&utm_medium=bio&utm_campaign=carrossel_educativo',
    imagem_desc: 'Carrossel explicativo passo a passo. Cada slide com número do passo, ícone simples e 1-2 frases. Paleta #182A39 + branco + #4CC5D7.',
  },
  // CARROSSEL 3 — Limpeza
  {
    canal: 'instagram', tipo: 'carrossel', nicho: 'Limpeza e Conservação',
    titulo: 'Empresas de limpeza têm um mercado bilionário esperando',
    conteudo: `SLIDE 1 (CAPA): "Se sua empresa faz limpeza, você tem um mercado bilionário esperando 🧹"

SLIDE 2: "Só em BH e RMBH, saem +800 editais de limpeza/conservação por mês"
→ Prefeituras, hospitais, escolas, autarquias — todos precisam de limpeza.

SLIDE 3: "A maioria das PMEs nem monitora esses editais"
→ Arte: funil mostrando quantas empresas chegam a tempo.

SLIDE 4: "As que monitoram? Chegam sozinhas, sem concorrência"
→ Arte: empresa solitária na frente do tribunal.

SLIDE 5: "O Conlicit envia esses editais todo dia para você, com resumo completo"
→ Arte: celular com notificação de edital.

SLIDE 6: "Objeto, valor, habilitações, prazo — tudo em 2 minutos"
→ Arte: checklist rápido.

SLIDE 7: "Sem precisar ler 80 páginas de PDF"
→ Arte: PDF reduzido para 1 página de resumo.

SLIDE 8: "Qual foi a última licitação de limpeza que você disputou?"
→ Engage pergunta. Fundo diferente.

SLIDE 9: "Se a resposta é 'nenhuma' ou 'faz tempo'..."

SLIDE 10 (CTA): "Receba editais de limpeza de graça → link na bio"`,
    hashtags: '#limpeza #conservacao #licitacoes #pregaoeletronico #PNCP #empresadeLimpeza #fornecedorpublico #conlicit',
    cta_texto: 'Receba editais de limpeza grátis',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=instagram&utm_medium=bio&utm_campaign=carrossel_limpeza',
    imagem_desc: 'Carrossel 10 slides. Capa: fundo verde escuro com ícone de vassoura. Slides internos: fundo claro, ícones do setor de limpeza. Slide 10: CTA escuro.',
  },
  // REELS 1
  {
    canal: 'instagram', tipo: 'reels', nicho: 'geral',
    titulo: 'Análise de edital em 30 segundos com o Edson IA',
    conteudo: `ROTEIRO (30 segundos):

0-3s: [Câmera frontal, tom direto]
"Esse edital tem 120 páginas. Vou resumir em 30 segundos."

3-10s: [Screencast do hub Conlicit]
Cola o número do edital no campo de busca. Clica em "Analisar com Edson".

10-25s: [Tela mostrando o resumo aparecendo]
Narração: "Objeto, valor estimado, exigências de habilitação, documentos necessários, pontos de atenção — tudo aqui."

25-30s: [Câmera frontal]
"Isso é o Conlicit. Link na bio pra testar de graça."

LEGENDA: "120 páginas → 30 segundos. Qual edital você quer que a gente analise? 👇
#licitacoes #IA #pregaoeletronico #PNCP #conlicit #fornecedorpublico"`,
    hashtags: '#licitacoes #IA #pregaoeletronico #PNCP #conlicit #fornecedorpublico #inteligenciaartificial',
    cta_texto: 'Teste grátis — link na bio',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=instagram&utm_medium=bio&utm_campaign=reels',
    imagem_desc: 'Vídeo vertical 9:16. Mescla câmera frontal (Sabrine) com screencast do hub. Legenda destacada no início. Seta no final apontando para a bio.',
  },
  // REELS 2
  {
    canal: 'instagram', tipo: 'reels', nicho: 'geral',
    titulo: 'Editais que ficam DESERTOS são oportunidade de ouro',
    conteudo: `ROTEIRO (30 segundos):

0-3s: [Hook forte]
"Editais que ficam sem proposta existem — e são oportunidade de ouro."

3-15s: [Explicação rápida]
"Quando uma licitação fica deserta, o órgão pode contratar por dispensa direta — sem pregão, sem disputa de preço. Com quem? Com quem estava monitorando."

15-25s: [Solução]
"O Conlicit monitora o PNCP e avisa quando editais do seu nicho abrem, reabrem ou ficam desertos — antes de qualquer concorrente."

25-30s: [CTA]
"Teste grátis → link na bio"

LEGENDA: "Edital deserto = contrato direto. Você sabia disso? 👇
#licitacoes #editadeserto #dispensa #PNCP #pregaoeletronico #conlicit"`,
    hashtags: '#licitacoes #editadeserto #dispensa #PNCP #pregaoeletronico #conlicit #fornecedorpublico',
    cta_texto: 'Teste grátis — link na bio',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=instagram&utm_medium=bio&utm_campaign=reels_deserto',
    imagem_desc: 'Vídeo vertical 9:16. Hook visual: texto "EDITAL DESERTO" em vermelho na tela. Transição para explicação com ícones. CTA final em tela escura.',
  },
  // STORIES
  {
    canal: 'instagram', tipo: 'story', nicho: 'geral',
    titulo: 'Story Enquete — Já participou de licitação?',
    conteudo: `[STORY COM ENQUETE]

Fundo: imagem escura com logo Conlicit

Texto: "Sua empresa já participou de licitação?"

Opção 1: "Sim, já participei ✅"
Opção 2: "Quero mas não sei como 🤔"

Após 24h: postar resposta com % e CTA para quem respondeu "Quero mas não sei"`,
    hashtags: null,
    cta_texto: 'Swipe up → análise gratuita',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=instagram&utm_medium=story&utm_campaign=enquete',
    imagem_desc: 'Story vertical. Fundo #182A39. Logo no topo. Enquete do Instagram com as 2 opções. Adesivo de "Poll".',
  },
  {
    canal: 'instagram', tipo: 'story', nicho: 'geral',
    titulo: 'Story CTA — Análise gratuita',
    conteudo: `[STORY COM LINK]

Visual: card escuro com logo Conlicit em destaque

Texto: "Manda o número do teu edital que a gente analisa de graça"

Link: conlicit.com/analise-gratuita
Sticker: → Deslize para cima

Variação com texto alternativo:
"Esse edital vale a pena disputar? A gente analisa em 2 minutos. Link 👆"`,
    hashtags: null,
    cta_texto: 'Análise gratuita',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=instagram&utm_medium=story&utm_campaign=cta_direto',
    imagem_desc: 'Story vertical. Fundo escuro #182A39. Logo centralizado. Texto em branco e ciano. Adesivo de link com seta.',
  },
  {
    canal: 'instagram', tipo: 'story', nicho: 'geral',
    titulo: 'Story Bastidores — Análise ao vivo',
    conteudo: `[STORY BASTIDORES]

Texto sobreposto em vídeo ou foto:

"Acabei de analisar um edital de [nicho] pra uma empresa de BH.

Em 2 minutos:
✅ Objeto claro
✅ Habilitações mapeadas
✅ Documentos listados
✅ 3 pontos de atenção

Quer o mesmo para o seu? Link na bio."

[Ou versão com screencast mostrando o resultado real, sem dados sigilosos]`,
    hashtags: null,
    cta_texto: 'Link na bio',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=instagram&utm_medium=story&utm_campaign=bastidores',
    imagem_desc: 'Story estilo bastidores/real. Foto ou vídeo da tela do hub com texto sobreposto em sticker. Fundo orgânico, tom autêntico.',
  },
];

// ─────────────────────────────────────────────────────────────
// Facebook
// ─────────────────────────────────────────────────────────────
const FACEBOOK_TEMPLATES = [
  // TIPO 1 — Pergunta + solução (grupos)
  {
    canal: 'facebook', tipo: 'post', nicho: 'geral',
    titulo: 'Alguém mais acha impossível monitorar o PNCP todo dia?',
    conteudo: `Alguém mais acha impossível ficar monitorando o PNCP todo dia?

A gente criou uma plataforma que faz isso automaticamente — manda alerta dos editais do seu nicho, gera resumo em 2 minutos e controla os prazos.

Quem quiser testar, estou dando análise gratuita de edital esta semana:
conlicit.com/analise-gratuita

Qual segmento vocês atuam? Comenta aqui 👇`,
    hashtags: '#licitacoes #PNCP #pregaoeletronico #fornecedorpublico #conlicit',
    cta_texto: 'Análise gratuita de edital',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=facebook&utm_medium=grupos&utm_campaign=posts',
    imagem_desc: 'Arte simples para grupos. Logo Conlicit. Texto da pergunta em destaque. Fundo neutro.',
  },
  // TIPO 2 — Dado + solução
  {
    canal: 'facebook', tipo: 'post', nicho: 'geral',
    titulo: 'R$ 272 bilhões para MPEs em 2025',
    conteudo: `Dado importante pra quem trabalha com licitações:

Em 2025, foram mais de 1 MILHÃO de compras públicas no PNCP.
R$ 272 bilhões foram para micro e pequenas empresas.

O problema: a maioria das PMEs não tem como monitorar tudo isso.
É exatamente por isso que o Conlicit existe.

Análise gratuita de edital → conlicit.com/analise-gratuita`,
    hashtags: '#licitacoes #MPE #pregaoeletronico #PNCP #fornecedorpublico #conlicit',
    cta_texto: 'Análise gratuita',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=facebook&utm_medium=grupos&utm_campaign=posts',
    imagem_desc: 'Arte com número "R$ 272 bilhões" em destaque. Fundo escuro Conlicit. Logo.',
  },
  // TIPO 3 — Licitação deserta (urgência)
  {
    canal: 'facebook', tipo: 'post', nicho: 'geral',
    titulo: 'Licitação deserta: oportunidade de contrato direto',
    conteudo: `Atenção fornecedores de [nicho] em [cidade/MG]:

Saiu um edital de [objeto genérico] que ficou DESERTO — sem nenhuma proposta.
Isso significa que o órgão pode contratar por dispensa direta.

Se sua empresa atua nesse segmento, você pode ser contatado.
Quer monitorar editais assim automaticamente?

→ conlicit.com/analise-gratuita (análise grátis)`,
    hashtags: '#licitacoes #dispensa #PNCP #pregaoeletronico #fornecedorpublico #conlicit',
    cta_texto: 'Monitorar automaticamente',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=facebook&utm_medium=grupos&utm_campaign=deserto',
    imagem_desc: 'Arte com ícone de alerta/sino. Texto "EDITAL DESERTO" em destaque. Logo Conlicit.',
  },
  // Pergunta — Limpeza
  {
    canal: 'facebook', tipo: 'post', nicho: 'Limpeza e Conservação',
    titulo: 'Empresas de limpeza: vocês monitoram editais de prefeitura?',
    conteudo: `Empresas de limpeza e conservação que atuam em BH e RMBH — vocês monitoram editais de prefeitura e hospitais no PNCP?

Porque toda semana saem novas licitações de serviços de limpeza e a maioria fica sem concorrentes suficientes.

Se quiser receber esses editais automaticamente com resumo, estou dando análise gratuita:
conlicit.com/analise-gratuita

Comenta aí o município que vocês atendem! 👇`,
    hashtags: '#licitacoes #limpeza #conservacao #PNCP #fornecedorpublico #BH #conlicit',
    cta_texto: 'Análise gratuita',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=facebook&utm_medium=grupos&utm_campaign=limpeza',
    imagem_desc: 'Arte com ícone de limpeza. Pergunta em destaque. Logo Conlicit.',
  },
  // Pergunta — Segurança
  {
    canal: 'facebook', tipo: 'post', nicho: 'Segurança / Vigilância',
    titulo: 'Empresas de vigilância: qual portal vocês usam para monitorar editais?',
    conteudo: `Empresas de vigilância e segurança patrimonial — qual portal vocês usam para monitorar editais do governo?

O PNCP centraliza tudo agora, mas filtrar por nicho e região é trabalhoso.

Criamos uma ferramenta que faz isso automaticamente pra vigilância. Quer testar?
conlicit.com/analise-gratuita

Comenta abaixo!`,
    hashtags: '#licitacoes #vigilancia #segurancapatriomonial #PNCP #fornecedorpublico #conlicit',
    cta_texto: 'Testar grátis',
    cta_link: 'https://conlicit.com/analise-gratuita?utm_source=facebook&utm_medium=grupos&utm_campaign=vigilancia',
    imagem_desc: 'Arte com ícone de escudo. Logo Conlicit. Pergunta em destaque.',
  },
  // Respostas rápidas — separadas por tipo
  {
    canal: 'facebook', tipo: 'resposta_rapida', nicho: 'geral',
    titulo: 'Resposta automática Messenger',
    conteudo: `Oi! 👋 Obrigada pelo contato com a Conlicit!
Posso analisar um edital de graça pra você.
Manda o número ou link: conlicit.com/analise-gratuita
Respondo em até 30 minutos! 🔵`,
    hashtags: null,
    cta_texto: null,
    cta_link: null,
    imagem_desc: null,
  },
  {
    canal: 'facebook', tipo: 'resposta_rapida', nicho: 'geral',
    titulo: 'Resposta para comentários em grupos',
    conteudo: `Oi [nome]! Manda o número do edital que a gente analisa agora de graça:
conlicit.com/analise-gratuita 🔵`,
    hashtags: null,
    cta_texto: null,
    cta_link: null,
    imagem_desc: null,
  },
  {
    canal: 'facebook', tipo: 'resposta_rapida', nicho: 'geral',
    titulo: 'Resposta para leads de anúncio',
    conteudo: `Olá [nome], tudo bem?

Vi que você se interessou pela análise gratuita do Conlicit!

Para analisar o edital, só me manda:
1. O número do edital (ex: 001/2026 - Prefeitura de BH)
2. Ou o link do PNCP

Analisamos em até 30 minutos e enviamos o resumo completo para você. 🔵`,
    hashtags: null,
    cta_texto: null,
    cta_link: null,
    imagem_desc: null,
  },
];

async function seedSocialTemplates(db) {
  const todos = [...LINKEDIN_TEMPLATES, ...INSTAGRAM_TEMPLATES, ...FACEBOOK_TEMPLATES];
  for (const t of todos) {
    await db.query(
      `INSERT INTO social_templates
         (canal, tipo, nicho, titulo, conteudo, hashtags, cta_texto, cta_link, imagem_desc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [t.canal, t.tipo, t.nicho, t.titulo || null, t.conteudo || null,
       t.hashtags || null, t.cta_texto || null, t.cta_link || null, t.imagem_desc || null],
    ).catch(e => console.error('[Seed] social_templates row error:', e.message));
  }
  console.log(`[Seed] ${todos.length} social_templates inseridos`);
}

module.exports = { seedSocialTemplates };
