const INSTRUCAO_JURIDICA_BASICA = `
ANÁLISE TÉCNICO-JURÍDICA — Lei 14.133/2021

Ao analisar habilitação, riscos e checklist, aplique os critérios abaixo com base na Lei nº 14.133/2021 e jurisprudência do TCU.

━━━ HABILITAÇÃO (Arts. 62–70) ━━━
Para cada documento de habilitação identificado no edital, classifique como:
- LEGAL: tem base expressa nos Arts. 62–70 da Lei 14.133/21
- ATENÇÃO: exigência que pode ser questionada (proporcionalidade, Art. 68)
- ILEGAL: contraria dispositivo expresso da lei

Alertas obrigatórios quando identificados:
- Capital mínimo > 10% do valor estimado → ilegal (Art. 66, §2º)
- Atestado com quantidade mínima > 50% do objeto → restritivo (jurisprudência TCU)
- Visita técnica obrigatória sem alternativa de declaração substitutiva → questionável
- Certidões com prazo de validade menor que o intervalo publicação→sessão → irregular
- Exigência de certidão fora da sede do licitante sem justificativa → restritivo (Art. 68)

━━━ RISCOS JURÍDICOS ━━━
Para cada risco identificado, informe:
- Descrição objetiva do risco
- Nível: Alto (ilegalidade flagrante), Médio (jurisprudência dividida), Baixo (boa prática)
- Fundamento legal específico (artigo + inciso quando aplicável)
- Recomendação prática para o fornecedor PME

━━━ INEXEQUIBILIDADE (Art. 59) ━━━
Ao calcular a planilha de preços, sinalize quando o valor proposto estiver:
- Abaixo de 50% do orçamento estimado (serviços com mão de obra) → presunção de inexequibilidade
- Abaixo de 75% do orçamento estimado (demais objetos) → presunção de inexequibilidade
Nestes casos, incluir no checklist: "Preparar planilha de composição de custos para diligência"

━━━ PRAZOS CRÍTICOS ━━━
Calcule e inclua no checklist operacional:
- Prazo máximo para impugnar o edital: 3 dias úteis antes da sessão (Art. 164)
- Prazo para manifestar intenção de recorrer: imediatamente após a sessão (Art. 165)
- Prazo para apresentar razões do recurso: 3 dias úteis após manifestação (Art. 166)
- Verificar se prazo de publicação foi respeitado: mínimo 8 dias úteis para pregão (Art. 55, §1º)

━━━ MODALIDADE ━━━
Verifique se a modalidade é adequada ao objeto:
- Pregão: apenas bens e serviços COMUNS (padrão de desempenho descritível no TR) — Art. 28
- Concorrência: obras, serviços de engenharia especiais, concessões — Art. 29
- Se objeto é bem/serviço comum mas a modalidade é Concorrência → risco de questionamento

━━━ CLÁUSULAS QUE EXIGEM ATENÇÃO ESPECIAL ━━━
Ao identificar, classifique como risco Alto:
- Exigência de exclusividade ou produto de marca específica sem justificativa técnica (Art. 40, §1º)
- Critério de julgamento subjetivo não previsto no edital
- Penalidade desproporcional para atraso (multa > 30% do valor contratual é questionável)
- Transferência de risco ao contratado por fatos imprevisíveis (Art. 124)
`;

const INSTRUCAO_RECURSO = `
GERAÇÃO DE RECURSO ADMINISTRATIVO — Lei 14.133/2021, Arts. 165–168
Estrutura obrigatória: 1.IDENTIFICAÇÃO 2.TEMPESTIVIDADE (Art.165-166) 3.LEGITIMIDADE E INTERESSE 4.CABIMENTO (Art.165) 5.RAZÕES DE MÉRITO (citar artigos, descrever tese TCU sem inventar número) 6.PEDIDO (reforma, nova sessão, efeito suspensivo se couber) 7.ENCERRAMENTO
Regras: nunca inventar artigos ou acórdãos — descrever a tese sem número. Ser objetivo. Focar no argumento mais forte.
`;

const INSTRUCAO_EXEQUIBILIDADE = `
PLANILHA DE EXEQUIBILIDADE — Art. 59 da Lei 14.133/2021
Para cada item licitado com valor estimado informado:
- Serviços com mão de obra dedicada: limiar = 50% do valor estimado unitário
- Produtos e demais serviços: limiar = 75% do valor estimado unitário
- Valor mínimo seguro recomendado: 80% do estimado
Quando qualquer item estiver abaixo do limiar, incluir no checklist: "⚠️ Preparar planilha detalhada de composição de custos para resposta à diligência de exequibilidade (Art. 59, §1º, Lei 14.133/21)."
`;

module.exports = { INSTRUCAO_JURIDICA_BASICA, INSTRUCAO_RECURSO, INSTRUCAO_EXEQUIBILIDADE };
