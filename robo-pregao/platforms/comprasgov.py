"""
RobôLicit — Módulo Compras.gov.br
Automatiza login, monitoramento e lances no portal compras.gov.br
"""

import logging
import time
import re
from typing import Optional
from platforms.base import PlataformaBase

logger = logging.getLogger("robolicit.comprasgov")

URL_BASE     = "https://www.gov.br/compras/pt-br"
URL_LOGIN    = "https://acesso.gov.br"
URL_PREGAO   = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-mobile/public/landing"


class ComprasGov(PlataformaBase):
    """
    Robô para o portal Compras.gov.br (antigo ComprasNet federal).
    Suporta pregão eletrônico na fase de lances.
    """

    def __init__(self, credenciais: dict, headless: bool = False):
        super().__init__(credenciais, headless)
        self.numero_pregao = None

    # ----------------------------------------------------------
    # LOGIN
    # ----------------------------------------------------------
    def fazer_login(self) -> bool:
        """
        Faz login via gov.br (CPF/CNPJ + senha).
        O portal usa autenticação federal — não armazenamos a senha.
        """
        try:
            logger.info("🔐 Iniciando login no Compras.gov...")
            self.page.goto(URL_LOGIN, wait_until="networkidle", timeout=30000)
            self.aguardar(1, 2)

            # Digita CPF/CNPJ
            campo_login = self.page.locator(
                "input[name='accountName'], input[id='login'], input[type='text']"
            ).first
            self.digitar_humanamente(campo_login, self.credenciais["login"])
            self.aguardar(0.5, 1)

            # Clica em continuar
            self.page.locator(
                "button[type='submit'], button:has-text('Continuar'), input[type='submit']"
            ).first.click()
            self.aguardar(1, 2)

            # Digita senha
            campo_senha = self.page.locator("input[type='password']").first
            self.digitar_humanamente(campo_senha, self.credenciais["senha"])
            self.aguardar(0.5, 1)

            # Confirma login
            self.page.locator(
                "button[type='submit'], button:has-text('Entrar'), button:has-text('Acessar')"
            ).first.click()

            # Aguarda redirecionamento
            self.page.wait_for_url("**/compras**", timeout=15000)
            self.logado = True
            logger.info("✅ Login realizado com sucesso")
            return True

        except Exception as e:
            logger.error(f"❌ Falha no login: {e}")
            self.tirar_screenshot("erro_login")
            return False

    # ----------------------------------------------------------
    # ACESSAR PREGÃO
    # ----------------------------------------------------------
    def acessar_pregao(self, numero_pregao: str) -> bool:
        """
        Navega até o pregão pelo número ou URL direta.
        """
        self.numero_pregao = numero_pregao
        try:
            logger.info(f"📋 Acessando pregão: {numero_pregao}")

            # Se passou URL direta
            if numero_pregao.startswith("http"):
                self.page.goto(numero_pregao, wait_until="networkidle", timeout=30000)
            else:
                # Busca pelo número
                url_busca = f"{URL_BASE}/editais?q={numero_pregao}"
                self.page.goto(url_busca, wait_until="networkidle", timeout=30000)
                self.aguardar(1, 2)

                # Clica no resultado
                link = self.page.locator(f"text={numero_pregao}").first
                link.click()
                self.aguardar(1, 2)

            # Verifica se chegou na página do pregão
            titulo = self.page.title()
            logger.info(f"📄 Página carregada: {titulo}")
            return True

        except Exception as e:
            logger.error(f"❌ Erro ao acessar pregão: {e}")
            self.tirar_screenshot("erro_acesso_pregao")
            return False

    # ----------------------------------------------------------
    # LER ESTADO DO PREGÃO
    # ----------------------------------------------------------
    def obter_melhor_lance(self) -> Optional[float]:
        """
        Lê o menor lance atual exibido na tela.
        """
        try:
            # Seletores possíveis na tela do pregão
            seletores = [
                "[class*='melhor-lance']",
                "[class*='menor-lance']",
                "[id*='melhorLance']",
                "[id*='valorAtual']",
                "td:has-text('Melhor Lance') + td",
                "span:has-text('R$')",
            ]

            for seletor in seletores:
                try:
                    elemento = self.page.locator(seletor).first
                    if elemento.is_visible(timeout=2000):
                        texto = elemento.inner_text()
                        valor = self._extrair_valor(texto)
                        if valor:
                            logger.debug(f"💰 Melhor lance: R$ {valor:.2f}")
                            return valor
                except:
                    continue

            logger.warning("⚠️ Não consegui ler o melhor lance na tela")
            return None

        except Exception as e:
            logger.error(f"❌ Erro ao ler melhor lance: {e}")
            return None

    def estou_vencendo(self) -> bool:
        """
        Verifica se meu lance está na liderança.
        """
        try:
            # Procura indicadores de vitória na tela
            indicadores = [
                "text=Você está vencendo",
                "text=Melhor Classificado",
                "[class*='vencendo']",
                "[class*='primeiro']",
                "text=1º lugar",
            ]
            for ind in indicadores:
                try:
                    if self.page.locator(ind).first.is_visible(timeout=1000):
                        return True
                except:
                    pass
            return False
        except:
            return False

    def obter_tempo_restante(self) -> int:
        """
        Lê o temporizador e retorna segundos restantes.
        """
        try:
            seletores_tempo = [
                "[id*='temporizador']",
                "[class*='timer']",
                "[class*='tempo']",
                "[class*='countdown']",
            ]

            for seletor in seletores_tempo:
                try:
                    el = self.page.locator(seletor).first
                    if el.is_visible(timeout=1000):
                        texto = el.inner_text()
                        segundos = self._parse_tempo(texto)
                        if segundos is not None:
                            return segundos
                except:
                    continue

            return 999  # desconhecido → assume que tem tempo

        except:
            return 999

    def pregao_encerrado(self) -> bool:
        """
        Detecta se o pregão foi fechado.
        """
        try:
            indicadores_fim = [
                "text=Pregão Encerrado",
                "text=Sessão Encerrada",
                "text=Disputa Encerrada",
                "[class*='encerrado']",
            ]
            for ind in indicadores_fim:
                try:
                    if self.page.locator(ind).first.is_visible(timeout=1000):
                        logger.info("🏁 Pregão encerrado detectado")
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
        """
        Digita e confirma o lance no campo da tela.
        """
        try:
            valor_fmt = self.formatar_valor(valor)
            logger.info(f"⚡ Dando lance: R$ {valor_fmt}")

            # Localiza o campo de lance
            campo_lance = self.page.locator(
                "input[name*='lance'], input[id*='lance'], "
                "input[placeholder*='lance'], input[placeholder*='valor']"
            ).first

            if not campo_lance.is_visible(timeout=5000):
                logger.error("❌ Campo de lance não encontrado na tela")
                self.tirar_screenshot("campo_lance_nao_encontrado")
                return False

            # Limpa e digita o valor
            campo_lance.click()
            campo_lance.fill("")
            self.digitar_humanamente(campo_lance, valor_fmt)
            self.aguardar(0.5, 1)

            # Botão de confirmar
            btn_confirmar = self.page.locator(
                "button:has-text('Enviar Lance'), "
                "button:has-text('Confirmar'), "
                "button[id*='btnLance'], "
                "input[value*='Lance']"
            ).first

            if not btn_confirmar.is_visible(timeout=3000):
                logger.error("❌ Botão de confirmar lance não encontrado")
                return False

            btn_confirmar.click()
            self.aguardar(1, 2)

            # Verificar confirmação
            if self._confirmar_dialog():
                logger.info(f"✅ Lance R$ {valor_fmt} confirmado!")
                return True

            logger.warning("⚠️ Lance enviado mas confirmação não detectada")
            return True  # assume sucesso

        except Exception as e:
            logger.error(f"❌ Erro ao dar lance: {e}")
            self.tirar_screenshot("erro_lance")
            return False

    def _confirmar_dialog(self) -> bool:
        """
        Confirma popup/dialog de confirmação de lance, se aparecer.
        """
        try:
            # Dialog nativo do browser
            self.page.on("dialog", lambda d: d.accept())

            # Botão de confirmação em modal
            btn_ok = self.page.locator(
                "button:has-text('OK'), button:has-text('Sim'), "
                "button:has-text('Confirmar')"
            ).first
            if btn_ok.is_visible(timeout=2000):
                btn_ok.click()
                return True
        except:
            pass
        return False

    # ----------------------------------------------------------
    # Utilitários
    # ----------------------------------------------------------
    def _extrair_valor(self, texto: str) -> Optional[float]:
        """
        Extrai valor numérico de strings como "R$ 1.234,56".
        """
        try:
            # Remove R$, espaços, pontos de milhar
            limpo = re.sub(r"[R$\s]", "", texto)
            limpo = limpo.replace(".", "").replace(",", ".")
            return float(limpo)
        except:
            return None

    def _parse_tempo(self, texto: str) -> Optional[int]:
        """
        Converte "12:34" ou "12m34s" em segundos.
        """
        try:
            # Formato MM:SS
            match = re.search(r"(\d+):(\d+)", texto)
            if match:
                minutos = int(match.group(1))
                segundos = int(match.group(2))
                return minutos * 60 + segundos

            # Só segundos
            match = re.search(r"(\d+)\s*s", texto)
            if match:
                return int(match.group(1))
        except:
            pass
        return None
