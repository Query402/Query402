# Testing

Query402 uses Vitest for deterministic, network-free unit and API integration tests.

## Commands

From the repository root:

```bash
npm test
```

Coverage report with baseline thresholds:

```bash
npm run test:coverage
```

Coverage output is written to `apps/api/coverage/`.

## What is covered

- Shared Zod schemas and provider/category validation (`packages/shared`)
- Public health, catalog, usage, and analytics routes (`apps/api`)
- Protected query input validation for search, news, and scrape
- Dynamic provider pricing for all paid modes
- Demo-mode 402 challenge and paid retry semantics without live credentials
- Agent-client URL construction and error handling
- Provider registry, scrape URL safety, sponsorship, and idempotency behavior

## Determinism and isolation

- Tests inject fixed timestamps where responses include time-dependent fields.
- Analytics SQLite storage uses a temporary database per test via `ANALYTICS_DB_PATH` and helpers in `apps/api/src/test/storage-test-helpers.ts`.
- Sponsorship/idempotency SQLite storage uses a temporary database per test via `SPONSORSHIP_DB_PATH`.
- Live Stellar testnet spending is out of scope for normal CI runs. Quality-gate and CI workflow changes are handled separately from this test foundation.

## Baseline thresholds

The API Vitest coverage config enforces these minimum thresholds:

- Lines: 35%
- Functions: 35%
- Statements: 35%
- Branches: 30%

Adjust thresholds in `apps/api/vitest.config.ts` only after intentional coverage improvements.

## Verification

Run the root test command twice and confirm identical passing results:

```bash
npm test
npm test
```

## Troubleshooting

### Rollup Optional Native Dependency Failures

During local setup or CI-like runtime execution, you may see an installation or build symptom indicating that native binary bindings like `@rollup/rollup-*-gnu` are missing.

To recover safely from this state without committing generated artifacts or causing lockfile churn:

1. Clean the invalid local node modules state:
   ```bash
   rm -rf node_modules
   ```
