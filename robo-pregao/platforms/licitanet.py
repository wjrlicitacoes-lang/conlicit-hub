"""
RobôLicit — platforms/licitanet.py
Módulo para o portal Licitanet
https://licitanet.com.br
"""

import logging
import re
from typing import Optional
from platforms.base import PlataformaBase

logger = logging.getLogger("robolicit.licitanet")

URL_LOGIN = "https://www.licitanet.com.br/Login"
URL_BASE  = "https://www.licitanet.com.br"


class Licitanet(PlataformaBase):
    """
    Robô para o portal Licitanet.
    Suporta pregão eletrônico na fase de disputa aberta.
    """

    def __init__(self, credenciais: dict, headless: bool = False):
        super().__init__(credenciais, headless)

    # ----------------------------------------------------------
    # LOGIN
    # ----------------------------------------------------------
    def fazer_login(self) -> bool:
        try:
            logger.info("🔐 Iniciando login no Licitanet...")
            self.page.goto(URL_LOGIN, wait_until="networkidle", timeout=30000)
            self.aguardar(1, 2)

            # CNPJ/usuário
            campo_usuario = self.page.locator(
                "input[id='txtLogin'], input[name='login'], "
                "input[placeholder*='CNPJ'], input[placeholder*='Usuário']"
            ).first
            self.digitar_humanamente(campo_usuario, self.credenciais["login"])
            self.aguardar(0.4, 0.9)

            # Senha
            campo_senha = self.page.locator("input[type='password']").first
            self.digitar_humanamente(campo_senha, self.credenciais["senha"])
            self.aguardar(0.4, 0.9)

            # Botão entrar
            self.page.locator(
                "input[id='btnEntrar'], button:has-text('Entrar'), "
                "input[type='submit']"
            ).first.click()

            self.page.wait_for_load_state("networkidle", timeout=15000)
            self.aguardar(1, 2)

            if "login" not in self.page.url.lower():
                self.logado = True
                logger.info("✅ Login Licitanet realizado")
                return True

            logger.error("❌ Login Licitanet falhou")
            self.tirar_screenshot("licitanet_erro_login")
            return False

        except Exception as e:
            logger.error(f"❌ Erro no login Licitanet: {e}")
            self.tirar_screenshot("licitanet_erro_login")
            return False

    # ----------------------------------------------------------
    # ACESSAR PREGÃO
    # ----------------------------------------------------------
    def acessar_pregao(self, numero_pregao: str) -> bool:
        try:
            logger.info(f"📋 Licitanet — acessando: {numero_pregao}")

            if numero_pregao.startswith("http"):
                self.page.goto(numero_pregao, wait_until="networkidle", timeout=30000)
            else:
                url = f"{URL_BASE}/Pregao/Busca?numero={numero_pregao}"
                self.page.goto(url, wait_until="networkidle", timeout=30000)
                self.aguardar(1, 2)
                try:
                    self.page.locator(
                        f"text={numero_pregao}, a[href*='Pregao']"
                    ).first.click()
                    self.aguardar(1, 2)
                except:
                    pass

            logger.info(f"📄 Licitanet — página: {self.page.title()}")
            return True

        except Exception as e:
            logger.error(f"❌ Licitanet — erro ao acessar: {e}")
            self.tirar_screenshot("licitanet_erro_acesso")
            return False

    # ----------------------------------------------------------
    # ESTADO DO PREGÃO
    # ----------------------------------------------------------
    def obter_melhor_lance(self) -> Optional[float]:
        try:
            seletores = [
                "#lblMelhorLance", "#lblLanceAtual", "#lblValorAtual",
                "[id*='MelhorLance']", "[id*='LanceAtual']",
                ".melhor-lance", ".lance-vencedor",
                "span:has-text('R$')",
            ]
            for seletor in seletores:
                try:
                    el = self.page.locator(seletor).first
                    if el.is_visible(timeout=1500):
                        valor = self._extrair_valor(el.inner_text())
                        if valor and valor > 0:
                            return valor
                except:
                    continue
            return None
        except:
            return None

    def estou_vencendo(self) -> bool:
        try:
            indicadores = [
                "text=Você está vencendo", "text=Melhor Lance",
                "[class*='vencendo']", "#lblStatusLance:has-text('1')",
                ".vencendo", ".primeiro-lugar",
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
                "#lblTempo", "#lblCronometro", "[id*='Tempo']",
                "[id*='Cronometro']", ".cronometro", ".timer-disputa",
            ]
            for seletor in seletores:
                try:
                    el = self.page.locator(seletor).first
                    if el.is_visible(timeout=800):
                        seg = self._parse_tempo(el.inner_text())
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
                "#lblStatus:has-text('Encerrado')",
                "[class*='encerrado']",
            ]
            for ind in indicadores:
                try:
                    if self.page.locator(ind).first.is_visible(timeout=800):
                        logger.info("🏁 Licitanet — encerrado")
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
            logger.info(f"⚡ Licitanet — lance: R$ {valor_fmt}")

            campo = self.page.locator(
                "input[id*='Lance'], input[id*='Valor'], "
                "input[name*='lance'], input.txt-lance"
            ).first

            if not campo.is_visible(timeout=5000):
                logger.error("❌ Licitanet — campo de lance não encontrado")
                return False

            self.digitar_humanamente(campo, valor_fmt)
            self.aguardar(0.3, 0.8)

            btn = self.page.locator(
                "input[id*='btnLance'], button:has-text('Enviar Lance'), "
                "button:has-text('Confirmar'), input[type='submit']"
            ).first

            if not btn.is_visible(timeout=3000):
                return False

            btn.click()
            self.aguardar(0.8, 1.5)

            # Confirma popup se aparecer
            try:
                self.page.on("dialog", lambda d: d.accept())
                btn_ok = self.page.locator(
                    "button:has-text('OK'), button:has-text('Sim')"
                ).first
                if btn_ok.is_visible(timeout=2000):
                    btn_ok.click()
            except:
                pass

            logger.info(f"✅ Licitanet — lance R$ {valor_fmt} enviado")
            return True

        except Exception as e:
            logger.error(f"❌ Licitanet — erro ao dar lance: {e}")
            self.tirar_screenshot("licitanet_erro_lance")
            return False

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
