"""
RobôLicit — Engine de Estratégia de Lances
Cérebro central que decide quanto e quando dar lances.
"""

import logging
from dataclasses import dataclass
from typing import Optional
from datetime import datetime, timedelta

logger = logging.getLogger("robolicit.engine")


@dataclass
class SituacaoLance:
    """Estado atual do pregão em um momento."""
    melhor_lance: float          # menor lance atual (vencendo)
    meu_lance_atual: float       # meu último lance dado
    estou_vencendo: bool         # True se meu lance é o menor
    tempo_restante_seg: int      # segundos para fechar
    num_concorrentes: int        # quantos ainda ativos
    rodada: int                  # número da rodada atual


@dataclass
class DecisaoLance:
    """O que o engine decidiu fazer."""
    dar_lance: bool
    valor: Optional[float]
    motivo: str
    urgencia: str               # "normal" | "urgente" | "aguardar"


class EngineEstrategia:
    """
    Decide se e quanto dar lance baseado na estratégia
    configurada para cada cliente.
    """

    MODOS = {
        "conservador": {"reducao_base": 0.3, "min_vantagem": 0.5},
        "moderado":    {"reducao_base": 0.5, "min_vantagem": 1.0},
        "agressivo":   {"reducao_base": 1.0, "min_vantagem": 0.1},
    }

    def __init__(self, config_cliente: dict, valor_base: float, valor_minimo: float):
        self.config = config_cliente
        self.valor_base = valor_base
        self.valor_minimo = valor_minimo
        self.estrategia = config_cliente.get("estrategia", {})
        self.historico_lances = []
        self.inicio = datetime.now()

    # ----------------------------------------------------------
    # Método principal — chame isso a cada ciclo do pregão
    # ----------------------------------------------------------
    def decidir(self, situacao: SituacaoLance) -> DecisaoLance:
        """
        Recebe a situação atual e retorna a decisão de lance.
        """

        # 1. Nunca ultrapassar o mínimo
        if situacao.melhor_lance <= self.valor_minimo:
            return DecisaoLance(
                dar_lance=False,
                valor=None,
                motivo=f"Lance atual ({situacao.melhor_lance:.2f}) já está no meu limite mínimo ({self.valor_minimo:.2f})",
                urgencia="aguardar"
            )

        # 2. Se estou vencendo e config diz pra não mexer
        if situacao.estou_vencendo and self.estrategia.get("entrar_so_se_perdendo", True):
            return DecisaoLance(
                dar_lance=False,
                valor=None,
                motivo="Estou vencendo — aguardando",
                urgencia="aguardar"
            )

        # 3. Calcular próximo lance
        novo_valor = self._calcular_lance(situacao)

        # 4. Checar se o novo valor ficaria abaixo do mínimo
        if novo_valor < self.valor_minimo:
            novo_valor = self.valor_minimo
            motivo = f"Lance ajustado para o mínimo: R$ {novo_valor:.2f}"
        else:
            motivo = f"Lance calculado pela estratégia {self.estrategia.get('modo', 'moderado')}"

        # 5. Verificar se o lance faz sentido (menor que o atual)
        if novo_valor >= situacao.melhor_lance:
            return DecisaoLance(
                dar_lance=False,
                valor=None,
                motivo=f"Meu lance calculado ({novo_valor:.2f}) não é menor que o atual ({situacao.melhor_lance:.2f})",
                urgencia="aguardar"
            )

        urgencia = self._avaliar_urgencia(situacao)
        self.historico_lances.append({
            "timestamp": datetime.now().isoformat(),
            "valor": novo_valor,
            "situacao": situacao
        })

        return DecisaoLance(
            dar_lance=True,
            valor=round(novo_valor, 2),
            motivo=motivo,
            urgencia=urgencia
        )

    # ----------------------------------------------------------
    # Cálculo do valor do próximo lance
    # ----------------------------------------------------------
    def _calcular_lance(self, situacao: SituacaoLance) -> float:
        modo = self.estrategia.get("modo", "moderado")
        reducao_pct = self.estrategia.get("reducao_pct", 0.5)

        # Nos últimos 2 minutos — modo final
        modo_final = self.estrategia.get("modo_final", "agressivo")
        if situacao.tempo_restante_seg < 120 and modo_final == "agressivo":
            reducao_pct = reducao_pct * 1.5  # mais agressivo no final
            logger.info("⚡ Modo final agressivo ativado")

        reducao_valor = situacao.melhor_lance * (reducao_pct / 100)
        novo_valor = situacao.melhor_lance - reducao_valor

        # Arredonda para centavos
        return round(novo_valor, 2)

    def _avaliar_urgencia(self, situacao: SituacaoLance) -> str:
        if situacao.tempo_restante_seg < 60:
            return "urgente"
        if situacao.tempo_restante_seg < 180:
            return "normal"
        return "normal"

    def resumo(self) -> dict:
        return {
            "total_lances": len(self.historico_lances),
            "valor_inicial": self.valor_base,
            "valor_minimo": self.valor_minimo,
            "menor_lance_dado": min((l["valor"] for l in self.historico_lances), default=None),
        }
