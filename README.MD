> [!NOTE]
> Query402 participates in the Drips Network Stellar Wave program. This public
> repository is the canonical workspace for Wave issues and contributions.

<div align="center">
  <img src="./public/Query402-logo.png" alt="Query402 logo" width="180" />
  <h1>Query402</h1>
  <p><strong>Agentic pay-per-query internet access on Stellar with x402.</strong></p>
  <p>
    <a href="https://github.com/emrekayat/Query402/actions/workflows/ci.yml">
      <img src="https://github.com/emrekayat/Query402/actions/workflows/ci.yml/badge.svg" alt="CI status" />
    </a>
  </p>
</div>

Query402 is a hackathon-ready marketplace-style router where agents can buy `search`, `news`, and `scrape` results per request instead of paying monthly subscriptions.

## Why this matters

- Agents should pay for exactly what they use.
- Providers can monetize API access per query.
- x402 + Stellar testnet enables programmable micropayment rails.
- Demo story is clear: **compare providers → pay per request → get results → view spend analytics**.

## Why Stellar + x402

- `x402` provides payment-required API patterns for paid HTTP routes.
- `stellar:testnet` provides low-friction testing with programmable token payments.
- Facilitator-based verification/settlement patterns are represented in the backend integration.

## Features (Phase 1–4)

- TypeScript monorepo with npm workspaces.
- Express API with provider catalog and protected paid routes.
- Provider abstraction for `search`, `news`, `scrape`.
- Configurable per-request pricing.
- Usage + payment persistence in SQLite (`apps/api/data/analytics.db`) via atomic storage adapter.
- Analytics endpoint for total spend and category breakdown.
- Agent CLI with commands for search/news/scrape.
- Deterministic `DEMO_MODE` fallback for hackathon reliability.
- Premium dark React dashboard with provider comparison, paid query workspace, results, and spend analytics.

## Architecture overview

Full technical breakdown: [`ARCHITECTURE.md`](./architecture.md)

- `apps/api`
  - Public routes: `/health`, `/api/providers`, `/api/catalog`, `/api/usage`, `/api/analytics`
  - Protected routes: `/x402/search`, `/x402/news`, `/x402/scrape`
  - Demo convenience route: `POST /api/demo/run`
  - x402 integration in `src/lib/x402.ts` (provider-aware dynamic route pricing)
  - Stellar config in `src/lib/stellar.ts`
  - Pricing in `src/lib/pricing.ts`
  - AI provider integration in `src/lib/groq.ts`
  - Persistence in `src/lib/persistence.ts`
- `apps/agent-client`
  - CLI commands for paid requests (`search`, `news`, `scrape`)
  - Demo script (`npm run demo --workspace @query402/agent-client`)
- `apps/web`
  - React + TypeScript + Vite + Tailwind frontend
  - Query workspace, provider cards, demo toggle, result panel
  - Usage and spend analytics dashboard
- `packages/shared`
  - Shared Zod schemas and types used by API + client

## Monorepo structure

```text
.
├─ apps/
│  ├─ api/
│  ├─ agent-client/
│  └─ web/
├─ packages/
│  └─ shared/
├─ .env.example
├─ package.json
├─ tsconfig.base.json
├─ README.MD
└─ ARCHITECTURE.md
```

## Environment variables

Copy `.env.example` to `.env` and fill values:

- `STELLAR_NETWORK` (default: `stellar:testnet`)
- `STELLAR_RPC_URL`
- `X402_FACILITATOR_URL`
- `X402_PAY_TO_ADDRESS`
- `DEMO_CLIENT_SECRET_KEY`
- `DEMO_CLIENT_PUBLIC_KEY`
- `PORT_API`
- `API_BASE_URL`
- `VITE_API_BASE_URL`
- `CORS_ORIGINS` (comma-separated allowed origins for API in production)
- `DEMO_MODE` (`true` for deterministic demo reliability)
- Optional keys: `BRAVE_API_KEY`, `SERPAPI_API_KEY`, `NEWS_API_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`

### Sponsorship Configuration (Optional)

To enable the sponsored-transaction setup for local demos, set `SPONSORSHIP_ENABLED=true` and configure the following variables. If sponsorship is disabled (the default), these variables are ignored and normal client-paid flow is used.

- `SPONSORSHIP_ENABLED` (`false` by default. Keep disabled for normal local development.)
- `SPONSORSHIP_SIGNING_SECRET` (Required if enabled. A Stellar secret key used to sponsor transactions. Use a fresh testnet key, do not use real production secrets, e.g. `S...`)
- `SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD` (Default: `10`. Maximum total USD spend allowed per day.)
- `SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD` (Default: `1`. Maximum USD spend allowed per client wallet per day.)
- `SPONSORSHIP_RATE_LIMIT_PER_MINUTE` (Default: `10`. Maximum sponsor requests per minute per wallet.)
- `SPONSORSHIP_GRANT_TTL_SECONDS` (Default: `300`. How long the sponsor grant is valid.)
- `SPONSORSHIP_CHALLENGE_TTL_SECONDS` (Default: `60`. Challenge expiration time.)
- `SPONSORSHIP_DB_PATH` (Default: `data/sponsorship.db`. Path to the local sqlite database tracking budgets.)

Deployment note:

- Render (API): set server vars like `GROQ_*`, `X402_*`, `CORS_ORIGINS`.
- Vercel (Web): set only `VITE_*` vars (for example `VITE_API_BASE_URL`).

## How to fund wallets on testnet

1. Generate Stellar keypairs for payer and seller.
2. Fund with Friendbot (testnet XLM).
3. Add USDC testnet trustline for relevant accounts.
4. Fund testnet USDC from Circle faucet.

## Setup

```bash
npm install
npm run typecheck
npm run build
```

## Tests

Run the full deterministic test suite from the repository root:

```bash
npm test
```

Generate coverage output and enforce the documented baseline thresholds:

```bash
npm run test:coverage
```

Details: [`docs/testing.md`](./docs/testing.md)

## Documentation

- **Testing strategy**: [`docs/testing.md`](./docs/testing.md)
- **Demo vs real payment evidence**: [`docs/demo-payment-evidence.md`](./docs/demo-payment-evidence.md)
- **Architecture overview**: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Quality gates

Run the same checks locally that CI enforces on pull requests:

```bash
npm ci
npm run clean
npm run typecheck
npm run build
npm run test
npm run lint
npm run format:check
npm run check:source-artifacts
```

Use `npm run clean` before quality gates when you want to remove local build output (`dist`), test coverage (`coverage`), and API runtime data under `apps/api/data`.

CI uses the Node version from `.nvmrc`, installs dependencies with `npm ci`, and does not require credentials or live Stellar payments.

## Run backend API

```bash
npm run dev:api
```

## Run frontend dashboard

```bash
npm run dev:web
```

Open: `http://localhost:5173`

Or production build:

```bash
npm run start:api
```

## Run agent client

Search:

```bash
npm run cli -- search "latest soroban updates" --provider search.basic
```

News:

```bash
npm run cli -- news "stablecoin micropayments" --provider news.fast
```

Scrape:

```bash
npm run cli -- scrape "https://developers.stellar.org" --provider scrape.page
```

Full CLI showcase:

```bash
npm run demo:agent
```

Real payment validation (`DEMO_MODE=false`):

```bash
npm run validate:real
```

If this passes, output includes payment proof fields (`payment-response`, trace id, provider, price).

## Real payment validation playbook

1. Set `DEMO_MODE=false` in `.env`.
2. Fill real funded keys (not placeholders):

- `DEMO_CLIENT_SECRET_KEY`
- `DEMO_CLIENT_PUBLIC_KEY`
- `X402_PAY_TO_ADDRESS`
- `X402_FACILITATOR_API_KEY` (for `channels.openzeppelin.com` facilitator)

3. If needed, create facilitator key: `https://channels.openzeppelin.com/testnet/gen`
4. Ensure API is running (`npm run dev:api`).
5. Run `npm run validate:real`.
6. Keep CLI output as judge proof screenshot/log.

Notes:

- Script checks API health and facilitator `/supported` reachability before payment attempt.
- If facilitator/wallet funding is not ready, the script fails fast with explicit reason.

## Demo flow (2–3 minutes)

1. Start API and Web.
2. In the dashboard, show provider cards with price, quality, and latency fields.
3. Select `search.basic` and run the query `latest stellar x402 updates`.
4. In the result panel, show provider, price, trace id, and timestamp fields.
5. In the analytics panel, explain total spend and category breakdown.
6. In the terminal, verify the same system through the CLI as a second channel.

## Demo rehearsal runbook (judge-safe)

Use these exact commands:

```bash
cd /Users/eminkaragoz/Desktop/projects/Query402
npm install
```

Terminal 1:

```bash
cd /Users/eminkaragoz/Desktop/projects/Query402
npm run dev:api
```

Terminal 2:

```bash
cd /Users/eminkaragoz/Desktop/projects/Query402
npm run dev:web
```

Terminal 3 (real payment proof):

```bash
cd /Users/eminkaragoz/Desktop/projects/Query402
npm run validate:real --workspace @query402/agent-client
```

Optional CLI proof:

```bash
cd /Users/eminkaragoz/Desktop/projects/Query402
npm run cli -- search "latest soroban updates" --provider search.basic
```

Expected proof during demo:

- `Status: 200`
- `payment-response` header value
- provider and paid price in output
- usage/analytics counters increasing in dashboard

## What is mocked vs real

- Provider content generation:
  - `search` / `news` / `scrape`: AI-generated via Groq when `GROQ_API_KEY` is configured.
  - Fallback: deterministic local provider outputs when Groq is unavailable or errors.
- Real x402 middleware integration: yes (`@x402/express`, `@x402/core`, `@x402/stellar`).
- Real Stellar payment execution: supported when `DEMO_MODE=false` and facilitator + funded wallets are reachable.
- Hackathon reliability fallback: `DEMO_MODE=true` returns proper 402 semantics and deterministic paid retry behavior.

## Real Stellar interaction

- Network config uses `stellar:testnet` + Soroban RPC URL.
- Client and server include Stellar x402 scheme integration (`@x402/stellar`).
- Facilitator URL is fully environment-driven.
- `npm run validate:real` provides a reproducible real-payment validation path for demo day.

## What judges should notice

- Clear pay-per-request UX for agent internet access.
- End-to-end paid route flow with auditable usage and spend.
- Provider comparison model with price/latency/quality metadata.
- Practical monorepo architecture that can be extended quickly.
- Demo reliability without sacrificing real integration paths.

## Open-source disclosure

- No proprietary provider APIs required for baseline demo.
- Optional provider adapters can be added via env keys.
- Demo mode is explicitly documented for hackathon determinism.

## Future improvements

- Add citation/link verification and stricter source quality filters for AI-generated results.
- Add richer payment metadata parsing from payment headers.
- Add integration tests with a reachable facilitator in CI.

## Submission packaging

Include these assets in your hackathon submission:

- `README.MD`
- `architecture.md`
- 3 screenshots:
  - dashboard query workspace with provider cards
  - successful paid result (trace + price visible)
  - usage analytics panel (total + breakdown)
- short terminal capture of `npm run validate:real --workspace @query402/agent-client`

Judge talking points (30-second version):

1. Query402 lets agents buy internet access per request, not subscription.
2. Paid routes are protected by x402 and settled on Stellar testnet.
3. Marketplace UX compares providers by price, latency, and quality.
4. Every paid call is logged into usage + spend analytics.
5. Real payment flow is reproducible with one validator command.

## Hackathon submission checklist

- [x] Monorepo setup
- [x] Backend API with paid routes
- [x] Agent CLI paid requests
- [x] Usage + spend analytics
- [x] Env + setup docs
- [x] Frontend dashboard
