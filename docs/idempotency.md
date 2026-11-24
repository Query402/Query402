# Idempotency & Replay Protection

Query402 paid execution supports client retries without double-charging or double-running providers.

Related: [Issue #4](https://github.com/emrekayat/Query402/issues/4)

## Header

```
Idempotency-Key: <uuid>
```

Clients generate a UUID per logical request and **reuse the same key** on safe retries (network blip, timeout). Generate a **new** key when inputs change.

## Fingerprint binding

The server hashes a canonical JSON object:

| Field             | Description                           |
| ----------------- | ------------------------------------- |
| `method`          | `GET` or `POST`                       |
| `route`           | e.g. `/x402/search`, `/api/paid/run`  |
| `provider`        | Provider id                           |
| `input`           | `{ q }` or `{ url }` (trimmed)        |
| `payer`           | Wallet public key or payment identity |
| `network`         | e.g. `stellar:testnet`                |
| `quotedAmountUsd` | Catalog price at execution time       |

Reusing `Idempotency-Key` with a **different fingerprint** → `409 idempotency_key_conflict`.

## Covered routes

| Route                | Method              |
| -------------------- | ------------------- |
| `GET /x402/search`   | Wallet / agent x402 |
| `GET /x402/news`     | Wallet / agent x402 |
| `GET /x402/scrape`   | Wallet / agent x402 |
| `POST /api/paid/run` | Sponsored flow      |

## HTTP behavior

| Situation                         | Status | Body                              |
| --------------------------------- | ------ | --------------------------------- |
| Cache hit (valid retry)           | `200`  | Original response                 |
| In-flight duplicate               | `409`  | `idempotency_in_progress`         |
| Key reused with different payload | `409`  | `idempotency_key_conflict`        |
| Storage unavailable               | `503`  | `idempotency_storage_unavailable` |

## Payment proof dedup

Settled x402 payments are deduplicated by on-chain `transactionHash` from typed payment evidence. Demo payments use a stable demo proof key. A replay with the same proof returns the cached response without re-executing the provider.

## Configuration

```env
IDEMPOTENCY_TTL_SECONDS=86400
```

Records expire after TTL; expired keys allow a fresh execution.

## Client usage

**Web (wallet):** `apps/web/src/lib/idempotency.ts` — key derived from route + provider + normalized query input + payment reference (the payer wallet address for x402). Sent only on the protected `/x402/*` routes; `apps/web/src/lib/api.ts` refuses to attach the key or any payment header to a public path.

**Web (sponsored):** same derivation on `POST /api/paid/run`, with the single-use grant nonce as the payment reference — a fresh grant never reuses a previous key.

**Agent:** `apps/agent-client/src/idempotency.ts` — same pattern on x402 GET.

## Guarantees

- Same `Idempotency-Key` + same fingerprint → at most **one** provider execution and **one** budget/spend on sponsored path.
- Concurrent identical requests → atomic lock; one winner, others `409` or cached `200`.

## Limitations

- Not exactly-once across third-party provider outages after partial execution.
- Without `Idempotency-Key`, retries are not deduplicated (except payment-proof replay on x402).
- Fingerprint includes quoted amount; catalog price changes invalidate cache alignment (by design).

## Storage

SQLite table `idempotency_keys` (shared DB with sponsorship enforcement). See `apps/api/src/lib/idempotency/service.ts`.
