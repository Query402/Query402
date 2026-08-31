# Analytics Storage

Query402 persists usage events, payment attempts, and x402 idempotency records through a typed `StorageRepository` adapter. Production uses **SQLite with WAL mode**; tests can use an in-memory backend.

Paths resolve from the **API package root** (`apps/api/`), not `process.cwd()`, so running the server from the monorepo root or from `apps/api/` writes to the same files.

---

## File locations

| File                     | Default path                                                | Env var               |
| ------------------------ | ----------------------------------------------------------- | --------------------- |
| Analytics SQLite DB      | `apps/api/data/analytics.db`                                | `ANALYTICS_DB_PATH`   |
| Sponsorship SQLite DB    | `apps/api/data/sponsorship.db`                              | `SPONSORSHIP_DB_PATH` |
| Legacy JSON (deprecated) | `apps/api/data/db.json` or `apps/api/apps/api/data/db.json` | —                     |

Both SQLite files are gitignored (`apps/api/data/*.db`, `apps/api/data/*.json`).

---

## Environment variables

```bash
# Storage backend: sqlite (default) or memory (tests only)
ANALYTICS_STORAGE=sqlite

# Absolute or API-package-relative path
ANALYTICS_DB_PATH=data/analytics.db
```

`ANALYTICS_STORAGE=memory` keeps all analytics in process memory — useful for unit tests, **not** for local dev or production (data is lost on restart).

---

## Local development

1. Start the API as usual:

   ```bash
   npm run dev:api
   ```

2. On first paid request, SQLite creates `apps/api/data/analytics.db` automatically (migrations run on open).

3. Inspect data:

   ```bash
   sqlite3 apps/api/data/analytics.db \
     "SELECT id, mode, price_usd, created_at FROM usage_events ORDER BY created_at DESC LIMIT 5;"
   ```

4. Dashboard widgets read from:
   - `GET /api/usage` — optional `?limit=` and `?offset=` (max 500 rows per export; returns HTTP 400 `over_limit_export_size` if exceeded)
   - `GET /api/analytics` — optional `?recentUsageLimit=` and `?recentPaymentLimit=` (max 500 rows per query; returns HTTP 400 `over_limit_export_size` if exceeded)


### Migrating from legacy `db.json`

If you have an old `db.json` from before issue #5:

```bash
# Preview counts
npm run migrate:analytics -- --dry-run

# Migrate (target DB must be empty)
npm run migrate:analytics

# Explicit paths
npm run migrate:analytics -- \
  --source apps/api/data/db.json \
  --target apps/api/data/analytics.db

# Merge into existing DB (skips duplicate ids)
npm run migrate:analytics -- --force

# Rename source file after success
npm run migrate:analytics -- --archive
```

The tool auto-discovers common legacy paths, including the old cwd bug path `apps/api/apps/api/data/db.json`.

---

## What is stored

**`usage_events`** — one row per paid query (mode, provider, price, trace id, sponsorship metadata).

**`payment_attempts`** — one row per settled payment (amount, network, tx hash, sponsorship metadata).

**`idempotency_keys`** — x402 idempotency locks and cached responses (separate from sponsorship idempotency in `sponsorship.db`).

Retention is bounded to the **500 most recent** usage events and payment attempts per table.

---

## Backup

### Analytics database

SQLite WAL mode produces three files when active:

- `analytics.db`
- `analytics.db-wal`
- `analytics.db-shm`

For a consistent backup while the API is running:

```bash
sqlite3 apps/api/data/analytics.db ".backup 'analytics-backup-$(date +%Y%m%d).db'"
```

For a cold backup (API stopped):

```bash
cp apps/api/data/analytics.db ~/backups/query402-analytics.db
```

### Sponsorship database

Sponsorship budget and nonce state lives in a separate file. Back it up the same way:

```bash
sqlite3 apps/api/data/sponsorship.db ".backup 'sponsorship-backup-$(date +%Y%m%d).db'"
```

### Recommended schedule

| Environment  | Suggestion                               |
| ------------ | ---------------------------------------- |
| Local dev    | Optional — reset by deleting `data/*.db` |
| Demo/staging | Copy before deployments                  |
| Production   | Automated daily backup of both DB files  |

---

## Restore

1. Stop the API.
2. Replace the database file:

   ```bash
   cp ~/backups/analytics-backup.db apps/api/data/analytics.db
   rm -f apps/api/data/analytics.db-wal apps/api/data/analytics.db-shm
   ```

3. Restart the API. Migrations are idempotent; existing schema is preserved.

If the analytics DB is missing or corrupt, the API still starts but persistence operations may fail until the file is recreated or restored. Sponsorship routes fail closed with `503` when `sponsorship.db` is unavailable.

---

## Troubleshooting

| Symptom                               | Likely cause                                 | Fix                                           |
| ------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| Empty analytics after upgrade         | New SQLite file; old data still in `db.json` | Run `npm run migrate:analytics`               |
| Data in wrong directory               | Old cwd-relative paths                       | Set absolute `ANALYTICS_DB_PATH`              |
| `UNIQUE constraint failed` on tx hash | Duplicate payment proof                      | Expected — duplicate settlements are rejected |
| Analytics reset on restart            | `ANALYTICS_STORAGE=memory`                   | Switch to `sqlite`                            |

---

## Architecture notes

- Payment + usage writes are **atomic** (single SQLite transaction via `persistPaymentAndUsage`).
- Writes are serialized through an async queue so synchronous SQLite I/O does not block the Express event loop.
- Read paths use `setImmediate` deferral for the same reason.
- See `apps/api/src/lib/storage/` for the interface, SQLite adapter, and migration module.
