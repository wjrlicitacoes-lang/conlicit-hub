# ConlicitHub API

API REST em Node.js para consulta de editais no [PNCP (Portal Nacional de Contratações Públicas)](https://pncp.gov.br).

## Pré-requisitos

- Node.js 18+
- npm

## Instalação

```bash
npm install
```

## Configuração

Copie o arquivo de exemplo e ajuste as variáveis se necessário:

```bash
cp .env.example .env
```

| Variável        | Descrição                        | Padrão                                    |
|-----------------|----------------------------------|-------------------------------------------|
| `PORT`          | Porta em que a API vai rodar     | `3000`                                    |
| `PNCP_BASE_URL` | URL base da API pública do PNCP  | `https://pncp.gov.br/api/consulta/v1`     |

## Como rodar

**Desenvolvimento** (reinicia automaticamente ao salvar):
```bash
npm run dev
```

**Produção:**
```bash
npm start
```

## Rotas

### `GET /health`
Verifica se a API está no ar.

**Exemplo de resposta:**
```json
{
  "status": "ok",
  "servico": "ConlicitHub API",
  "timestamp": "2026-05-17T12:00:00.000Z"
}
```

---

### `GET /editais`
Busca editais publicados no PNCP com suporte a filtros por palavra-chave, estado e modalidade.

**Parâmetros de query:**

| Parâmetro       | Tipo   | Obrigatório | Descrição                                                    |
|-----------------|--------|-------------|--------------------------------------------------------------|
| `dataInicial`   | string | Sim         | Data inicial no formato `YYYYMMDD`                           |
| `dataFinal`     | string | Sim         | Data final no formato `YYYYMMDD`                             |
| `q`             | string | Não         | Palavra-chave buscada no objeto e no nome do órgão           |
| `uf`            | string | Não         | Sigla do estado (ex: `MG`, `SP`, `RJ`)                       |
| `modalidade`    | string | Não         | Modalidade de contratação (ver tabela abaixo)                |
| `pagina`        | number | Não         | Número da página (padrão: `1`)                               |
| `tamanhoPagina` | number | Não         | Itens por página (padrão: `10`)                              |

**Modalidades aceitas no parâmetro `modalidade`:**

| Valor                       | Código PNCP |
|-----------------------------|-------------|
| `pregão eletrônico`         | 6           |
| `pregão presencial`         | 7           |
| `concorrência eletrônica`   | 4           |
| `concorrência presencial`   | 5           |
| `concorrência`              | 4           |
| `dispensa de licitação`     | 8           |
| `inexigibilidade`           | 9           |
| `leilão eletrônico`         | 1           |
| `leilão presencial`         | 13          |
| `diálogo competitivo`       | 2           |
| `concurso`                  | 3           |
| `credenciamento`            | 12          |
| `manifestação de interesse` | 10          |
| `pré-qualificação`          | 11          |

**Exemplos de requisição:**
```
GET /editais?dataInicial=20260501&dataFinal=20260517
GET /editais?dataInicial=20260501&dataFinal=20260517&q=limpeza&uf=MG
GET /editais?dataInicial=20260501&dataFinal=20260517&modalidade=pregão eletrônico&uf=SP
```

**Exemplo de resposta:**
```json
{
  "total": 123,
  "pagina": 1,
  "tamanhoPagina": 10,
  "dados": [
    {
      "numeroEdital": "00394502000144-6-000001/2026",
      "orgao": "MINISTÉRIO DA SAÚDE",
      "objeto": "Contratação de serviços de limpeza e conservação",
      "valorEstimado": "R$ 150.000,00",
      "dataPublicacao": "01/05/2026",
      "modalidade": "Pregão - Eletrônico",
      "estado": "Distrito Federal",
      "municipio": "Brasília",
      "link": "https://pncp.gov.br/app/editais/00394502000144/2026/1"
    }
  ]
}
```

> **Nota sobre busca por palavra-chave (`q`):** o filtro é aplicado localmente sobre os resultados retornados pelo PNCP. Em períodos com muitos editais, considere reduzir o intervalo de datas para obter resultados mais precisos.

---

### `GET /editais/:cnpj/:ano/:sequencial`
Busca um edital específico pelo CNPJ do órgão, ano e número sequencial.

Os valores de `cnpj`, `ano` e `sequencial` estão presentes no campo `link` retornado pela listagem.

**Exemplo de requisição:**
```
GET /editais/00394502000144/2026/1
```

**Exemplo de resposta:**
```json
{
  "numeroEdital": "00394502000144-6-000001/2026",
  "orgao": "MINISTÉRIO DA SAÚDE",
  "objeto": "Contratação de serviços de limpeza e conservação",
  "valorEstimado": "R$ 150.000,00",
  "dataPublicacao": "01/05/2026",
  "modalidade": "Pregão - Eletrônico",
  "estado": "Distrito Federal",
  "municipio": "Brasília",
  "link": "https://pncp.gov.br/app/editais/00394502000144/2026/1"
}
```

**Resposta quando não encontrado (`404`):**
```json
{
  "mensagem": "Edital não encontrado: CNPJ 00394502000144, ano 2026, sequencial 1."
}
```

## Estrutura do projeto

```
conlicit-hub/
├── src/
│   ├── app.js                        # Ponto de entrada da aplicação
│   ├── routes/
│   │   ├── editais.js                # Rotas de editais
│   │   └── health.js                 # Rota de health check
│   └── controllers/
│       ├── editaisController.js      # Lógica de consulta ao PNCP
│       └── healthController.js       # Lógica do health check
├── .env                              # Variáveis de ambiente (não versionado)
├── .env.example                      # Modelo de variáveis de ambiente
└── package.json
```
