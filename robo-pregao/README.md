# 🤖 RobôLicit — Robô de Pregão Eletrônico

Sistema automatizado de lances para pregões eletrônicos com IA por cliente.

---

## 📁 Estrutura do Projeto

```
robo-pregao/
├── main.py                  ← INICIA O ROBÔ (execute este)
├── core/
│   └── engine.py            ← cérebro: decide quando e quanto dar lance
├── platforms/
│   ├── base.py              ← classe base (todas as plataformas herdam)
│   └── comprasgov.py        ← módulo Compras.gov.br ✅ pronto
├── config/
│   └── clientes.yaml        ← seus clientes, credenciais e estratégias
├── editais/                 ← suba os PDFs dos editais aqui
├── planilhas/               ← suba as planilhas .xlsx aqui
└── logs/                    ← resultados e screenshots automáticos
```

---

## ⚙️ Instalação (Windows ou Mac)

### 1. Instalar Python
Baixe em: https://python.org/downloads  
Marque "Add Python to PATH" durante a instalação.

### 2. Instalar dependências
Abra o terminal (CMD no Windows / Terminal no Mac) dentro da pasta do projeto:

```bash
pip install playwright pyyaml openpyxl
python -m playwright install chromium
```

---

## 🚀 Como usar

### Passo 1 — Configurar o cliente
Edite `config/clientes.yaml` com os dados reais:

```yaml
- id: cliente_001
  nome: "Nome da Empresa"
  credenciais:
    comprasgov:
      login: "seu_cpf_ou_cnpj"
      senha: "sua_senha"
  estrategia:
    modo: "moderado"         # conservador | moderado | agressivo
    reducao_pct: 0.5         # reduz 0,5% a cada lance
    intervalo_seg: 30        # verifica a cada 30 segundos
    modo_final: "agressivo"  # mais rápido nos últimos 2 min
    entrar_so_se_perdendo: true
```

### Passo 2 — Rodar o robô

```bash
python main.py \
  --cliente cliente_001 \
  --pregao PE-2024-0891 \
  --plataforma comprasgov \
  --base 5200.00 \
  --minimo 4600.00
```

#### Com URL direta do pregão:
```bash
python main.py \
  --cliente cliente_001 \
  --pregao "https://www.comprasnet.gov.br/seguro/loginPortal.asp" \
  --plataforma comprasgov \
  --base 5200.00 \
  --minimo 4600.00
```

#### Modo invisível (segundo plano):
```bash
python main.py --cliente cliente_001 --pregao PE-0001 \
  --plataforma comprasgov --base 5200 --minimo 4600 --headless
```

---

## 🧠 Estratégias Disponíveis

| Modo | Redução por lance | Quando usar |
|------|-------------------|-------------|
| `conservador` | -0,3% | Margem apertada |
| `moderado` | -0,5% | Uso geral |
| `agressivo` | -1,0% | Quer ganhar a qualquer custo |
| `personalizado` | você define | Máximo controle |

---

## 📊 Resultados

Após cada pregão, o robô salva em `logs/`:
- **Log completo** de tudo que aconteceu
- **JSON com resultado**: total de lances, menor valor dado, se ganhou
- **Screenshots** em caso de erro (para debug)

---

## 🗺️ Roadmap

- [x] Etapa 1 — Dashboard web
- [x] Etapa 2 — Engine + Compras.gov
- [ ] Etapa 3 — BNC + Licitanet
- [ ] Etapa 4 — Leitura de edital com IA (OpenClaw)
- [ ] Etapa 5 — Multi-pregão simultâneo
- [ ] Etapa 6 — Notificação WhatsApp/Telegram

---

## ⚠️ Observações Importantes

1. **Teste primeiro** com um pregão de baixo valor
2. **Nunca deixe o mínimo zerado** — o robô nunca vai abaixo
3. **Monitore as primeiras sessões** com `headless=False` (navegador visível)
4. Use VPS ou deixe o computador ligado durante o pregão
