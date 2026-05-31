"""
RobôLicit — platforms/bnc.py
Módulo para o portal BNC (Banco Nacional de Compras)
https://bnc.org.br
"""

import logging
import time
import re
from typing import Optional
from platforms.base import PlataformaBase

logger = logging.getLogger("robolicit.bnc")

URL_LOGIN  = "https://www.bnc.org.br/login"
URL_BASE   = "https://www.bnc.org.br"


class BNC(PlataformaBase):
    """
    Robô para o portal BNC — Banco Nacional de Compras.
    Suporta pregão eletrônico na fase de disputa de lances.
    """

    def __init__(self, credenciais: dict, headless: bool = False):
        super().__init__(credenciais, headless)
        self.numero_pregao = None

    # ----------------------------------------------------------
    # LOGIN
    # ----------------------------------------------------------
    def fazer_login(self) -> bool:
        try:
            logger.info("🔐 Iniciando login no BNC...")
            self.page.goto(URL_LOGIN, wait_until="networkidle", timeout=30000)
            self.aguardar(1, 2)

            # Campo de CNPJ/CPF ou email
            campo_usuario = self.page.locator(
                "input[name='username'], input[id='username'], "
                "input[placeholder*='CNPJ'], input[placeholder*='CPF'], "
                "input[type='text']:first-of-type"
            ).first
            self.digitar_humanamente(campo_usuario, self.credenciais["login"])
            self.aguardar(0.5, 1)

            # Senha
            campo_senha = self.page.locator("input[type='password']").first
            self.digitar_humanamente(campo_senha, self.credenciais["senha"])
            self.aguardar(0.5, 1)

            # Botão entrar
            self.page.locator(
                "button[type='submit'], button:has-text('Entrar'), "
                "button:has-text('Acessar'), input[type='submit']"
            ).first.click()

            # Aguarda carregar painel
            self.page.wait_for_load_state("networkidle", timeout=15000)
            self.aguardar(1, 2)

            # Verifica se logou (não está mais na página de login)
            if "login" not in self.page.url.lower():
                self.logado = True
                logger.info("✅ Login BNC realizado")
                return True

            logger.error("❌ Login BNC falhou — ainda na página de login")
            self.tirar_screenshot("bnc_erro_login")
            return False

        except Exception as e:
            logger.error(f"❌ Erro no login BNC: {e}")
            self.tirar_screenshot("bnc_erro_login")
            return False

    # ----------------------------------------------------------
    # ACESSAR PREGÃO
    # ----------------------------------------------------------
    def acessar_pregao(self, numero_pregao: str) -> bool:
        self.numero_pregao = numero_pregao
        try:
            logger.info(f"📋 BNC — acessando pregão: {numero_pregao}")

            if numero_pregao.startswith("http"):
                self.page.goto(numero_pregao, wait_until="networkidle", timeout=30000)
            else:
                # Busca no portal
                url_busca = f"{URL_BASE}/pregao/busca?numero={numero_pregao}"
                self.page.goto(url_busca, wait_until="networkidle", timeout=30000)
                self.aguardar(1, 2)

                # Clica no primeiro resultado
                try:
                    link = self.page.locator(
                        f"text={numero_pregao}, a[href*='pregao'], "
                        "table tbody tr:first-child a"
                    ).first
                    link.click()
                    self.aguardar(1, 2)
                except:
                    logger.warning("⚠️ Link do pregão não encontrado via busca")

            logger.info(f"📄 BNC — página: {self.page.title()}")
            return True

        except Exception as e:
            logger.error(f"❌ BNC — erro ao acessar pregão: {e}")
            self.tirar_screenshot("bnc_erro_acesso")
            return False

    # ----------------------------------------------------------
    # LER ESTADO
    # ----------------------------------------------------------
    def obter_melhor_lance(self) -> Optional[float]:
        try:
            seletores = [
                "[class*='melhor-lance']",
                "[class*='menor-lance']",
                "[class*='lance-atual']",
                "[id*='melhorLance']",
                "[id*='valorAtual']",
                "[id*='lanceAtual']",
                "td.lance-valor",
                ".disputa-lance",
                # Tenta qualquer valor em R$ visível na área de lances
                ".area-lances span:has-text('R$')",
            ]
            for seletor in seletores:
                try:
                    el = self.page.locator(seletor).first
                    if el.is_visible(timeout=1500):
                        valor = self._extrair_valor(el.inner_text())
                        if valor and valor > 0:
                            logger.debug(f"💰 BNC — melhor lance: R$ {valor:.2f}")
                            return valor
                except:
                    continue
            return None
        except Exception as e:
            logger.error(f"❌ BNC — erro ao ler lance: {e}")
            return None

    def estou_vencendo(self) -> bool:
        try:
            indicadores = [
                "text=Você está vencendo",
                "text=Melhor oferta",
                "text=1º",
                "[class*='vencendo']",
                "[class*='lider']",
                ".badge-sucesso",
                ".status-vencendo",
            ]
            for ind in indicadores:
                try:
                    if self.page.locator(ind).first.is_visible(timeout=800):
                        return True
                except:
                    pass
            return False
        except:
            return False

    def obter_tempo_restante(self) -> int:
        try:
            seletores = [
                "[id*='timer']", "[id*='tempo']", "[id*='countdown']",
                "[class*='timer']", "[class*='cronometro']",
                ".tempo-restante", "#temporizador",
            ]
            for seletor in seletores:
                try:
                    el = self.page.locator(seletor).first
                    if el.is_visible(timeout=800):
                        texto = el.inner_text()
                        seg = self._parse_tempo(texto)
                        if seg is not None:
                            return seg
                except:
                    continue
            return 999
        except:
            return 999

    def pregao_encerrado(self) -> bool:
        try:
            indicadores = [
                "text=Pregão Encerrado", "text=Disputa Encerrada",
                "text=Sessão Encerrada", "text=Leilão Encerrado",
                "[class*='encerrado']", ".status-encerrado",
            ]
            for ind in indicadores:
                try:
                    if self.page.locator(ind).first.is_visible(timeout=800):
                        logger.info("🏁 BNC — pregão encerrado")
                        return True
                except:
                    pass
            return False
        except:
            return False

    # ----------------------------------------------------------
    # DAR LANCE
    # ----------------------------------------------------------
    def dar_lance(self, valor: float) -> bool:
        try:
            valor_fmt = self.formatar_valor(valor)
            logger.info(f"⚡ BNC — dando lance: R$ {valor_fmt}")

            campo = self.page.locator(
                "input[name*='lance'], input[id*='lance'], "
                "input[placeholder*='lance'], input[placeholder*='valor'], "
                "input.campo-lance"
            ).first

            if not campo.is_visible(timeout=5000):
                logger.error("❌ BNC — campo de lance não encontrado")
                self.tirar_screenshot("bnc_campo_lance_nao_encontrado")
                return False

            self.digitar_humanamente(campo, valor_fmt)
            self.aguardar(0.3, 0.8)

            btn = self.page.locator(
                "button:has-text('Enviar'), button:has-text('Confirmar'), "
                "button:has-text('Lance'), button[id*='btnLance'], "
                "button.btn-lance, button.enviar-lance"
            ).first

            if not btn.is_visible(timeout=3000):
                logger.error("❌ BNC — botão de lance não encontrado")
                return False

            btn.click()
            self.aguardar(0.8, 1.5)
            self._confirmar_dialog()

            logger.info(f"✅ BNC — lance R$ {valor_fmt} enviado")
            return True

        except Exception as e:
            logger.error(f"❌ BNC — erro ao dar lance: {e}")
            self.tirar_screenshot("bnc_erro_lance")
            return False

    def _confirmar_dialog(self):
        try:
            self.page.on("dialog", lambda d: d.accept())
            btn_ok = self.page.locator(
                "button:has-text('OK'), button:has-text('Sim'), "
                "button:has-text('Confirmar')"
            ).first
            if btn_ok.is_visible(timeout=2000):
                btn_ok.click()
        except:
            pass

    def _extrair_valor(self, texto: str) -> Optional[float]:
        try:
            limpo = re.sub(r"[R$\s]", "", texto)
            limpo = limpo.replace(".", "").replace(",", ".")
            return float(limpo)
        except:
            return None

    def _parse_tempo(self, texto: str) -> Optional[int]:
        try:
            match = re.search(r"(\d+):(\d+)", texto)
            if match:
                return int(match.group(1)) * 60 + int(match.group(2))
            match = re.search(r"(\d+)\s*s", texto)
            if match:
                return int(match.group(1))
        except:
            pass
        return None
