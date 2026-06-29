export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  query_or_url TEXT NOT NULL,
  price_usd REAL NOT NULL,
  network TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  payment_tx_hash TEXT,
  facilitator_url TEXT,
  payer_public_key TEXT,
  trace_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  sponsorship_grant_id TEXT,
  policy_decision TEXT,
  payment_source TEXT,
  sponsor_public_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events (created_at DESC);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  network TEXT NOT NULL,
  payer_public_key TEXT,
  pay_to_address TEXT NOT NULL,
  facilitator_url TEXT NOT NULL,
  status TEXT NOT NULL,
  transaction_hash TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sponsorship_grant_id TEXT,
  policy_decision TEXT,
  payment_source TEXT,
  sponsor_public_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_created_at ON payment_attempts (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_transaction_hash
  ON payment_attempts (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys (expires_at);
`
  },
  {
    version: 2,
    sql: `
ALTER TABLE usage_events ADD COLUMN payment_kind TEXT;
ALTER TABLE usage_events ADD COLUMN asset TEXT;
ALTER TABLE usage_events ADD COLUMN pay_to_address TEXT;
ALTER TABLE usage_events ADD COLUMN amount TEXT;

ALTER TABLE payment_attempts ADD COLUMN asset TEXT;
ALTER TABLE payment_attempts ADD COLUMN amount TEXT;
ALTER TABLE payment_attempts ADD COLUMN evidence_kind TEXT;
ALTER TABLE payment_attempts ADD COLUMN facilitator_result TEXT;
`
  },
  {
    version: 3,
    sql: `
ALTER TABLE usage_events ADD COLUMN execution_source TEXT;
ALTER TABLE usage_events ADD COLUMN execution_used_fallback INTEGER;
ALTER TABLE usage_events ADD COLUMN execution_fallback_reason TEXT;
ALTER TABLE usage_events ADD COLUMN execution_latency_estimate_ms INTEGER;
ALTER TABLE usage_events ADD COLUMN execution_observed_duration_ms INTEGER;
ALTER TABLE usage_events ADD COLUMN execution_circuit_breaker_state TEXT;
`
  }
];
