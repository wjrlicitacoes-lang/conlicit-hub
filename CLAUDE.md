# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Development (auto-restart via nodemon)
npm run dev

# Production
npm start

# Health check
curl http://localhost:3000/health
```

No test suite or linter is currently configured.

## Architecture Overview

**ConlicitHub** is a multi-tenant SaaS platform for Brazilian public procurement (licitações), with three components:

- **Backend API** — Node.js/Express, the core of the system
- **Web Dashboard** — Vanilla HTML/CSS/JS in `public/`
- **RobôLicit** — Python Playwright-based automated bidding robot in `robo-pregao/`

### Backend Layer Structure

```
src/
├── app.js              # Express setup, CORS, route mounting, middleware
├── routes/             # ~25 route files — thin, delegate to controllers
├── controllers/        # Business logic per module
├── services/           # Cross-module reusable logic (email, AI, PNCP sync)
├── middleware/autenticar.js  # JWT validation + RBAC permission matrix
├── database/db.js      # PostgreSQL pool (max 5 conns — Supabase free tier)
├── cron/agendador.js   # All scheduled background jobs
└── lib/cripto.js       # Encryption utilities
```

### Key Modules

**PNCP Sync** (`services/pncpSyncService.js`): Pulls procurement notices from the Brazilian government API daily at 6 AM, stores them in `editais_cache`. Batches 5 concurrent requests at 50 items/page.

**Edson (AI analysis)** (`services/edsonService.js`): Uses the Anthropic Claude API to analyze procurement notices — extracts items, scores viability (0–100), evaluates legal risks. Results stored in `analises_edson`. Model controlled by `CLAUDE_MODEL_EDSON` env var (default: `claude-haiku-4-5`).

**Boletim (newsletter)** (`services/boletimService.js`): Generates daily email summaries at 7 AM for clients matching their procurement segments. Uses Resend for delivery.

**Authentication**: JWT + RBAC. Roles include `socio_fundador`, `admin`, `assistente`, `operador`, `diretor_comercial`, `sdr`, `social_media`, `cliente`, `assistente_junior`. Per-user permission overrides stored in `usuario_permissoes`.

**Cron jobs** (`cron/agendador.js`):
- 6 AM: PNCP sync
- 7 AM: Boletim dispatch
- 8 AM: Document expiration alerts
- 9 AM: Prospect follow-up
- Every 30 min: Pregão alerts
- Every 6 hours: Anthropic credit check
- Hourly: Opportunity follow-up (auto-expires at 72h)

### RobôLicit (Python)

Located in `robo-pregao/`. Uses Playwright for browser automation across platforms: ComprasGov, BNC, Licitanet, BBMNet. Client credentials and bidding strategies (`conservador`, `moderado`, `agressivo`) defined in `config/clientes.yaml`.

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL (Supabase) connection string |
| `JWT_SECRET` | Token signing secret |
| `ANTHROPIC_API_KEY` | Claude API — powers "Edson" analysis |
| `CLAUDE_MODEL_EDSON` | Which Claude model to use for analysis |
| `RESEND_API_KEY` | Email delivery for newsletters |
| `ZAPI_INSTANCE` / `ZAPI_TOKEN` / `ZAPI_CLIENT_TOKEN` | WhatsApp via Z-API |
| `ADMIN_WHATSAPP` / `ADMIN_EMAIL` | Alert recipients |
| `ENCRYPTION_KEY` | 64-char hex key for credential encryption |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `BREVO_API_KEY` | Brevo email marketing |

See `.env.example` for the full list with defaults.

## External Services

- **PNCP** (`pncp.gov.br/api/consulta/v1`) — Source for all procurement notice data
- **Anthropic Claude** — AI analysis engine ("Edson")
- **Supabase** — Hosted PostgreSQL (5-connection pool limit on free tier)
- **Resend** — Transactional email
- **Z-API** — WhatsApp messaging
- **Brevo** — Email marketing campaigns
- **Railway.app** — Production hosting (`railway.json`, `nixpacks.toml`)

## Conventions

- All UI, logs, and user-facing strings are in **Portuguese (PT-BR)**.
- Route files are thin wrappers; business logic lives in controllers and services.
- The `--dns-result-order=ipv4first` Node flag is required for production (IPv4 priority with Supabase).
- Public routes that do not require auth (e.g., lead forms, webhook receivers) are defined before the `autenticar` middleware in `app.js`.
