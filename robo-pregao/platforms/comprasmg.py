"""
RobôLicit — Módulo Compras MG (compras.mg.gov.br)

Diferente dos outros módulos em platforms/ (comprasgov.py, bnc.py,
licitanet.py), este NÃO usa Playwright com automação de navegador.

Motivo: o portal compras.mg.gov.br expõe uma API JSON real por trás da
tela (confirmado em 07/07/2026 inspecionando a rede de uma sessão já
autenticada da Sabrine, com o consentimento dela). Isso permite ler o
estado da disputa com uma chamada HTTP simples, sem precisar simular
clique de mouse, digitação, nem nenhuma técnica de evasão de detecção.

IMPORTANTE — o que ESTE módulo faz e não faz, no estado atual:

  ✅ Lê o estado do(s) lote(s) de um procedimento (situação, melhor
     valor atual) via API real.
  ❌ AINDA NÃO envia lance sozinho — o endpoint de envio não foi
     mapeado ainda, porque só observamos um processo já encerrado.
     Antes do teste ao vivo de amanhã, o endpoint de envio precisa ser
     capturado observando a rede durante um lance manual real (a
     Sabrine dá um lance manualmente uma vez, com a aba de rede aberta,
     e capturamos a chamada).

Por isso o fluxo de amanhã é OBRIGATORIAMENTE semi-automático: este
módulo calcula e mostra o valor sugerido (via core/engine.py, reaproveitando
SituacaoLance/DecisaoLance que já existem), e a Sabrine confirma cada
lance manualmente na tela até mapearmos o endpoint de envio com segurança.
"""

import logging
import re
from datetime import datetime
from typing import Optional

import requests

logger = logging.getLogger("robolicit.comprasmg")

BASE_URL = "https://www1.compras.mg.gov.br"


def _parse_valor_br(valor_str: Optional[str]) -> Optional[float]:
    """Converte '1.031.930,00' -> 1031930.00"""
    if not valor_str:
        return None
    limpo = valor_str.replace(".", "").replace(",", ".")
    try:
        return float(limpo)
    except ValueError:
        return None


class ComprasMG:
    """
    Módulo de LEITURA para compras.mg.gov.br via API real.

    Uso:
        sessao = requests.Session()
        sessao.cookies.update(cookies_exportados_do_navegador_logado)
        robo = ComprasMG(sessao)
        estado = robo.ler_lotes(id_procedimento=42583)

    A autenticação continua manual (login feito pela Sabrine no navegador);
    este módulo só reaproveita a sessão HTTP já autenticada — não faz
    login programático nem simula formulário.
    """

    def __init__(self, sessao: requests.Session):
        self.sessao = sessao

    def ler_lotes(self, id_procedimento: int, tamanho_pagina: int = 10) -> dict:
        """
        Chama o endpoint real confirmado:
          GET /servico/procedimentolei14133/lote/acoes/recuperatodos/{id}
              ?inversaoFase=false&page=1&participanteLote=true&sizePerPage=N&sort

        Retorna o JSON bruto (ainda não convertido pra SituacaoLance, porque
        falta confirmar amanhã, com disputa ativa, quais campos mapeiam
        tempo_restante_seg e meu_lance_atual — ver notas no topo do arquivo).
        """
        url = (
            f"{BASE_URL}/servico/procedimentolei14133/lote/acoes/recuperatodos/{id_procedimento}"
            f"?inversaoFase=false&page=1&participanteLote=true&sizePerPage={tamanho_pagina}&sort"
        )
        resp = self.sessao.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def resumo_lote(self, dados_lotes: dict, numero_lote: int) -> dict:
        """
        Extrai um resumo legível de um lote específico a partir do JSON
        bruto retornado por ler_lotes(). Campos confirmados reais:
        situacao.descricao, valorTotal, maiorOferta, souParticipante.

        ⚠️ ATENÇÃO — ACHADO IMPORTANTE (07/07/2026): comparando com a aba
        DISPUTA da própria tela (que mostra colunas separadas "Melhor lance"
        e "Meu melhor lance"), o campo `valorTotal` desta API bateu com
        "Meu melhor lance" da Sabrine, e NÃO com o "Melhor lance" geral da
        disputa (o valor do concorrente líder). Ou seja: este endpoint,
        pelo menos como usado aqui (participanteLote=true), parece devolver
        uma visão PARTICIPANTE-ESPECÍFICA, não o valor absoluto da disputa.

        Isso é crítico: o motor de decisão precisa do valor do CONCORRENTE
        líder pra calcular o próximo lance, não do seu próprio valor. Antes
        de usar isto em produção — mesmo em modo semi-automático — precisa
        confirmar (a) se existe um parâmetro/endpoint que devolve o valor
        absoluto da disputa, ou (b) se isso só aparece com a disputa ativa
        (pode ser que em disputa aberta o campo se comporte diferente do
        que numa disputa já encerrada/pós-habilitação, que foi o único caso
        que pude observar agora). NÃO usar o valorTotal daqui como
        "menor_lance_atual" do motor sem essa confirmação.

        Campos AINDA NÃO confirmados (não presentes com disputa encerrada):
        tempo restante, número de lances dados.
        """
        lote = next(
            (l for l in dados_lotes.get("lotes", []) if l.get("numero") == numero_lote),
            None,
        )
        if lote is None:
            raise ValueError(f"Lote {numero_lote} não encontrado na resposta da API.")

        return {
            "numero": lote.get("numero"),
            "situacao_id": lote["situacao"]["id"],
            "situacao_descricao": lote["situacao"]["descricao"],
            # NOME PROPOSITALMENTE CAUTELOSO: ver o aviso no docstring acima.
            # Ainda não confirmado se isto é o valor líder da disputa ou o
            # meu próprio valor. Não renomear para "melhor_valor_atual" ou
            # "menor_lance_atual" até confirmar amanhã.
            "valor_total_reportado_pela_api": _parse_valor_br(lote.get("valorTotal")),
            "sou_o_melhor": lote.get("maiorOferta", False),
            "sou_participante": lote.get("souParticipante", False),
            "lido_em": datetime.now().isoformat(),
        }

    def dar_lance(self, id_procedimento: int, numero_lote: int, valor: float) -> bool:
        raise NotImplementedError(
            "Endpoint de envio de lance ainda não mapeado. Antes de habilitar "
            "isto, capturar a chamada real observando a rede durante um lance "
            "manual (ver instruções no topo do arquivo)."
        )
