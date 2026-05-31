"""
RobôLicit — Plataforma Base
Todas as plataformas (ComprasGov, BNC, etc.) herdam desta classe.
"""

import logging
import time
import random
from abc import ABC, abstractmethod
from typing import Optional
from playwright.sync_api import sync_playwright, Browser, Page, BrowserContext

logger = logging.getLogger("robolicit.platform")


class PlataformaBase(ABC):
    """
    Classe base para todos os robôs de plataforma.
    Define o contrato que cada plataforma deve implementar.
    """

    def __init__(self, credenciais: dict, headless: bool = False):
        """
        headless=False → abre o navegador visível (recomendado para testes)
        headless=True  → roda em segundo plano (produção)
        """
        self.credenciais = credenciais
        self.headless = headless
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.logado = False

    # ----------------------------------------------------------
    # Métodos obrigatórios — cada plataforma implementa os seus
    # ----------------------------------------------------------

    @abstractmethod
    def fazer_login(self) -> bool:
        """Faz login na plataforma. Retorna True se OK."""
        pass

    @abstractmethod
    def acessar_pregao(self, numero_pregao: str) -> bool:
        """Navega até o pregão. Retorna True se encontrou."""
        pass

    @abstractmethod
    def obter_melhor_lance(self) -> Optional[float]:
        """Lê o menor lance atual na tela. Retorna o valor."""
        pass

    @abstractmethod
    def estou_vencendo(self) -> bool:
        """Verifica se meu lance é o menor."""
        pass

    @abstractmethod
    def obter_tempo_restante(self) -> int:
        """Retorna segundos restantes do pregão."""
        pass

    @abstractmethod
    def dar_lance(self, valor: float) -> bool:
        """Digita e confirma o lance. Retorna True se OK."""
        pass

    @abstractmethod
    def pregao_encerrado(self) -> bool:
        """Retorna True se o pregão fechou."""
        pass

    # ----------------------------------------------------------
    # Métodos comuns — já implementados para todas as plataformas
    # ----------------------------------------------------------

    def iniciar_navegador(self):
        """Abre o Playwright e o Chrome."""
        logger.info(f"🌐 Iniciando navegador (headless={self.headless})")
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(
            headless=self.headless,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",  # evita detecção
            ]
        )
        self.context = self.browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1366, "height": 768},
        )
        self.page = self.context.new_page()
        logger.info("✅ Navegador iniciado")

    def fechar_navegador(self):
        """Fecha o navegador com segurança."""
        try:
            if self.context:
                self.context.close()
            if self.browser:
                self.browser.close()
            if self.playwright:
                self.playwright.stop()
            logger.info("🔒 Navegador fechado")
        except Exception as e:
            logger.warning(f"Erro ao fechar navegador: {e}")

    def aguardar(self, min_seg: float = 1.0, max_seg: float = 3.0):
        """
        Pausa aleatória para simular comportamento humano.
        Nunca age rápido demais — evita bloqueios.
        """
        tempo = random.uniform(min_seg, max_seg)
        logger.debug(f"⏳ Aguardando {tempo:.1f}s")
        time.sleep(tempo)

    def tirar_screenshot(self, nome: str = "screenshot"):
        """Salva print da tela para debug."""
        if self.page:
            caminho = f"logs/{nome}_{int(time.time())}.png"
            self.page.screenshot(path=caminho)
            logger.info(f"📸 Screenshot salvo: {caminho}")

    def digitar_humanamente(self, seletor: str, texto: str):
        """
        Digita caractere por caractere com delay aleatório
        para parecer digitação humana.
        """
        self.page.click(seletor)
        self.page.fill(seletor, "")  # limpa o campo
        for char in str(texto):
            self.page.keyboard.type(char)
            time.sleep(random.uniform(0.05, 0.15))

    def formatar_valor(self, valor: float) -> str:
        """Formata R$ 1.234,56 no padrão brasileiro."""
        return f"{valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    def __enter__(self):
        self.iniciar_navegador()
        return self

    def __exit__(self, *args):
        self.fechar_navegador()
