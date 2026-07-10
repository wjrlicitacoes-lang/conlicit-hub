"""
RobôLicit — ler_mg.py
Runner semi-automático para compras.mg.gov.br, usando platforms/comprasmg.py.

Diferente de main.py (que roda o loop 100% automático via Playwright para
ComprasGov/BNC/Licitanet), este script NUNCA dá lance sozinho:

  1. Lê o estado do lote via API real (ComprasMG.ler_lotes/resumo_lote).
  2. Pede pra você confirmar na tela o valor do MELHOR LANCE do concorrente
     líder — porque ainda não está confirmado se o campo `valorTotal` da
     API é esse valor ou o seu próprio (ver aviso em platforms/comprasmg.py,
     função resumo_lote). Enquanto isso não for confirmado com a disputa
     ativa, o script não usa o valor da API para calcular o lance sozinho.
  3. Calcula a sugestão de lance com core/engine.py (mesma engine dos
     outros módulos) e mostra na tela.
  4. Você dá o lance manualmente no navegador. O script nunca chama
     ComprasMG.dar_lance() — esse método nem está implementado ainda
     (levanta NotImplementedError de propósito).

Uso:
    python ler_mg.py --cliente cliente_001 --procedimento 42583 --lote 1 \
        --cookies cookies_mg.json

O arquivo de cookies é um JSON simples {"nome_cookie": "valor", ...}
exportado da sessão já logada da Sabrine no navegador. Nunca commitar esse
arquivo (está no .gitignore).
"""

import argparse
import json
import logging
import time

import requests
import yaml

from core.engine import EngineEstrategia, SituacaoLance
from platforms.comprasmg import ComprasMG

logger = logging.getLogger("robolicit.ler_mg")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)


def carregar_config_yaml() -> dict:
    with open("config/clientes.yaml", "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def buscar_cliente_yaml(config, cliente_id):
    for c in config.get("clientes", []):
        if c["id"] == cliente_id:
            return c
    return None


def carregar_cookies(caminho: str) -> dict:
    with open(caminho, "r", encoding="utf-8") as f:
        return json.load(f)


def montar_sessao(cookies: dict) -> requests.Session:
    sessao = requests.Session()
    sessao.cookies.update(cookies)
    return sessao


def pedir_valor_lider(valor_reportado_api) -> float:
    """
    Pede confirmação manual do valor do melhor lance (concorrente líder),
    porque a API ainda não teve esse campo confirmado (ver aviso em
    platforms/comprasmg.py). Mostra o valor bruto da API só como referência.
    """
    print(f"   (valor bruto reportado pela API, NÃO confirmado como sendo do líder: {valor_reportado_api})")
    while True:
        bruto = input("   Confirme na tela o valor do MELHOR LANCE (concorrente líder), em R$: ").strip()
        bruto = bruto.replace("R$", "").strip().replace(".", "").replace(",", ".")
        try:
            return float(bruto)
        except ValueError:
            print("   Valor inválido, tente de novo (ex: 1031930.00 ou 1.031.930,00).")


def rodar(cliente_id: str, id_procedimento: int, numero_lote: int, cookies_path: str, intervalo_seg: int,
          valor_base: float, valor_minimo: float):
    config = carregar_config_yaml()
    cliente = buscar_cliente_yaml(config, cliente_id)
    if not cliente:
        print(f"❌ Cliente '{cliente_id}' não encontrado em config/clientes.yaml")
        return

    config_cliente = {"id": cliente_id, "nome": cliente.get("nome", ""), "estrategia": cliente.get("estrategia", {})}
    engine = EngineEstrategia(config_cliente=config_cliente, valor_base=valor_base, valor_minimo=valor_minimo)

    sessao = montar_sessao(carregar_cookies(cookies_path))
    robo = ComprasMG(sessao)

    logger.info("=" * 60)
    logger.info(f"🤖 RobôLicit (semi-automático) — {cliente.get('nome','')} | ComprasMG")
    logger.info(f"   Procedimento: {id_procedimento} | Lote: {numero_lote}")
    logger.info("   ⚠️  Este script NÃO dá lance sozinho. Ele só sugere — você confirma na tela.")
    logger.info("=" * 60)

    rodada = 0
    try:
        while True:
            rodada += 1
            dados = robo.ler_lotes(id_procedimento)
            resumo = robo.resumo_lote(dados, numero_lote)

            print(f"\n[Rodada {rodada}] Situação: {resumo['situacao_descricao']} | "
                  f"Sou participante: {resumo['sou_participante']} | "
                  f"Sou o melhor: {resumo['sou_o_melhor']}")

            if resumo["sou_o_melhor"]:
                print("   🏆 Você está vencendo — aguardando, nenhuma sugestão necessária.")
                time.sleep(intervalo_seg)
                continue

            melhor_lance = pedir_valor_lider(resumo["valor_total_reportado_pela_api"])
            tempo_restante = int(input("   Tempo restante do pregão, em segundos (veja o cronômetro na tela): ").strip())

            situacao = SituacaoLance(
                melhor_lance=melhor_lance,
                meu_lance_atual=engine.historico_lances[-1]["valor"] if engine.historico_lances else valor_base,
                estou_vencendo=False,
                tempo_restante_seg=tempo_restante,
                num_concorrentes=0,
                rodada=rodada,
            )
            decisao = engine.decidir(situacao)
            print(f"   🧠 {decisao.motivo}")
            if decisao.dar_lance and decisao.valor:
                print(f"   💡 SUGESTÃO: dê um lance de R$ {decisao.valor:,.2f} manualmente na tela, se concordar.")
            else:
                print("   ⏳ Engine recomenda não dar lance agora.")

            resposta = input("   Enter para checar de novo, 'q' para sair: ").strip().lower()
            if resposta == "q":
                break
            time.sleep(intervalo_seg)
    except KeyboardInterrupt:
        print("\n👋 Encerrado pelo usuário.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cliente", required=True, help="id do cliente em config/clientes.yaml")
    parser.add_argument("--procedimento", required=True, type=int, help="id_procedimento do compras.mg.gov.br")
    parser.add_argument("--lote", required=True, type=int, help="número do lote a monitorar")
    parser.add_argument("--cookies", required=True, help="caminho do JSON com cookies da sessão logada")
    parser.add_argument("--intervalo", type=int, default=20, help="segundos entre checagens (padrão: 20)")
    parser.add_argument("--base", type=float, required=True, help="valor base da proposta (R$)")
    parser.add_argument("--minimo", type=float, required=True, help="valor mínimo aceitável (R$)")
    args = parser.parse_args()

    rodar(args.cliente, args.procedimento, args.lote, args.cookies, args.intervalo, args.base, args.minimo)
