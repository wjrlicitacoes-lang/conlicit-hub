"""
RobôLicit — main.py (v3 — Etapa 4)
Adiciona BNC e Licitanet ao mapa de plataformas.
Substitui o main.py anterior.
"""

import logging, time, yaml, json, os, argparse
from datetime import datetime
from typing import Optional

from core.engine import EngineEstrategia, SituacaoLance
from platforms.comprasgov import ComprasGov
from platforms.bnc        import BNC
from platforms.licitanet  import Licitanet

os.makedirs("logs", exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(f"logs/robo_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")
    ]
)
logger = logging.getLogger("robolicit.main")

# ── Mapa de plataformas (atualizado na Etapa 4) ──────────────
PLATAFORMAS = {
    "comprasgov":  ComprasGov,
    "comprasnet":  ComprasGov,   # mesmo módulo
    "bnc":         BNC,
    "licitanet":   Licitanet,
    "bec/sp":      BNC,          # BEC usa fluxo similar ao BNC
    "comprasbr":   ComprasGov,
    "bbmnet":      BNC,
}

def carregar_config_runtime(caminho: str) -> dict:
    with open(caminho, "r", encoding="utf-8") as f:
        return json.load(f)

def carregar_config_yaml() -> dict:
    with open("config/clientes.yaml", "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def buscar_cliente_yaml(config, cliente_id):
    for c in config.get("clientes", []):
        if c["id"] == cliente_id:
            return c
    return None

def salvar_resultado(pregao_id, numero, engine, ganhou):
    resultado = {
        "data": datetime.now().isoformat(),
        "pregao_id": pregao_id,
        "pregao": numero,
        "ganhou": ganhou,
        **engine.resumo()
    }
    caminho = f"logs/resultado_{pregao_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    print(f"RESULTADO:{json.dumps(resultado)}")

def rodar_pregao(config: dict, headless: bool = True):
    pregao_id     = config.get("pregao_id", 0)
    numero_pregao = config.get("numero_pregao") or config.get("pregao", "")
    link_pregao   = config.get("link_pregao", "")
    plataforma    = config.get("plataforma", "comprasgov").lower()
    valor_base    = float(config.get("valor_base", 0))
    valor_minimo  = float(config.get("valor_minimo", 0))
    credenciais   = config.get("credenciais", {})
    est           = config.get("estrategia", {})

    config_cliente = {
        "id": config.get("cliente_id", ""),
        "nome": config.get("cliente_nome", ""),
        "estrategia": {
            "modo":                  est.get("modo", "moderado"),
            "reducao_pct":           float(est.get("reducao_pct", 0.5)),
            "intervalo_seg":         int(est.get("intervalo_seg", 30)),
            "modo_final":            est.get("modo_final", "agressivo"),
            "entrar_so_se_perdendo": est.get("entrar_so_se_perdendo", True),
        }
    }

    logger.info("=" * 60)
    logger.info(f"🤖 RobôLicit — {config.get('cliente_nome','')} | {plataforma.upper()}")
    logger.info(f"   Pregão: {numero_pregao} | Base: R${valor_base:,.2f} | Mín: R${valor_minimo:,.2f}")
    logger.info("=" * 60)

    PlataformaClass = PLATAFORMAS.get(plataforma)
    if not PlataformaClass:
        logger.error(f"❌ Plataforma '{plataforma}' não suportada. Disponíveis: {list(PLATAFORMAS.keys())}")
        return

    engine = EngineEstrategia(config_cliente=config_cliente, valor_base=valor_base, valor_minimo=valor_minimo)
    ganhou = False
    identificador = link_pregao or numero_pregao
    intervalo = config_cliente["estrategia"]["intervalo_seg"]

    with PlataformaClass(credenciais, headless=headless) as robo:
        if not robo.fazer_login():
            logger.error("❌ Login falhou"); return
        if not robo.acessar_pregao(identificador):
            logger.error("❌ Não consegui acessar o pregão"); return

        logger.info("🎯 Monitorando...")
        rodada = 0

        while True:
            rodada += 1
            if robo.pregao_encerrado():
                ganhou = robo.estou_vencendo()
                print(f"STATUS:{'vencido' if ganhou else 'perdido'}")
                logger.info(f"🏁 {'🏆 GANHOU!' if ganhou else '❌ Não ganhou'}")
                break

            melhor = robo.obter_melhor_lance()
            tempo  = robo.obter_tempo_restante()
            vence  = robo.estou_vencendo()

            if melhor is None:
                logger.warning("⚠️ Não consegui ler o lance"); time.sleep(10); continue

            situacao = SituacaoLance(
                melhor_lance=melhor, meu_lance_atual=engine.historico_lances[-1]["valor"] if engine.historico_lances else valor_base,
                estou_vencendo=vence, tempo_restante_seg=tempo, num_concorrentes=0, rodada=rodada
            )
            logger.info(f"[R{rodada}] R${melhor:,.2f} | {tempo}s | {'✅' if vence else '❌'}")

            decisao = engine.decidir(situacao)
            logger.info(f"🧠 {decisao.motivo}")

            if decisao.dar_lance and decisao.valor:
                if robo.dar_lance(decisao.valor):
                    logger.info(f"✅ Lance R$ {decisao.valor:,.2f} enviado")
                    print(f"LANCE:{decisao.valor}")

            _int = 5 if decisao.urgencia == "urgente" else (intervalo * 2 if decisao.urgencia == "aguardar" else intervalo)
            time.sleep(_int)

    salvar_resultado(pregao_id, numero_pregao, engine, ganhou)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config-runtime")
    parser.add_argument("--cliente")
    parser.add_argument("--pregao")
    parser.add_argument("--plataforma", default="comprasgov")
    parser.add_argument("--base",    type=float)
    parser.add_argument("--minimo",  type=float)
    parser.add_argument("--headless", action="store_true")
    args = parser.parse_args()

    if args.config_runtime:
        rodar_pregao(carregar_config_runtime(args.config_runtime), headless=True)
    elif args.cliente and args.pregao:
        cfg = carregar_config_yaml()
        c   = buscar_cliente_yaml(cfg, args.cliente)
        if not c: print(f"❌ Cliente '{args.cliente}' não encontrado"); exit(1)
        rodar_pregao({
            "pregao_id": 0, "cliente_id": args.cliente, "cliente_nome": c.get("nome",""),
            "numero_pregao": args.pregao, "plataforma": args.plataforma,
            "valor_base": args.base, "valor_minimo": args.minimo,
            "credenciais": c["credenciais"].get(args.plataforma, {}),
            "estrategia": c.get("estrategia", {}),
        }, headless=args.headless)
    else:
        parser.print_help()
