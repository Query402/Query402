import { config } from "../config.js";
import { getSponsorshipDb } from "../sponsorship/store.js";

const PENDING_STATUS_CODE = 0;

export interface CachedIdempotencyResponse {
  hit: true;
  statusCode: number;
  body: unknown;
}

export interface IdempotencyMiss {
  hit: false;
  conflict?: boolean;
}

export type IdempotencyAcquireResult =
  | { state: "acquired" }
  | { state: "cached"; statusCode: number; body: unknown }
  | { state: "in_progress" }
  | { state: "conflict" };

export type PaymentProofLookup =
  | { hit: true; body: unknown }
  | { hit: false; conflict?: boolean };

function ttlSeconds() {
  return config.IDEMPOTENCY_TTL_SECONDS;
}

function ensurePaymentProofHashColumn(): void {
  const database = getSponsorshipDb();
  const columns = database.prepare(`PRAGMA table_info(payment_proofs)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "request_hash")) {
    database.exec(`ALTER TABLE payment_proofs ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''`);
  }
}

export function isIdempotencyStorageAvailable(): boolean {
  try {
    getSponsorshipDb();
    return true;
  } catch {
    return false;
  }
}

function isPending(statusCode: number): boolean {
  return statusCode <= PENDING_STATUS_CODE;
}

/**
 * Expire completed records past TTL. In-flight (pending) locks are retained so
 * a slow provider call is not dropped mid-flight.
 */
function deleteIfExpiredCompleted(
  database: ReturnType<typeof getSponsorshipDb>,
  key: string,
  statusCode: number,
  expiresAt: string
): boolean {
  if (new Date(expiresAt).getTime() > Date.now()) {
    return false;
  }

  if (isPending(statusCode)) {
    return false;
  }

  database.prepare(`DELETE FROM idempotency_keys WHERE key = ?`).run(key);
  return true;
}

export function acquireIdempotencyLock(
  key: string,
  requestHash: string,
  ttl = ttlSeconds()
): IdempotencyAcquireResult {
  const database = getSponsorshipDb();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const existing = database
    .prepare(
      `SELECT request_hash, response_json, status_code, expires_at
       FROM idempotency_keys
       WHERE key = ?`
    )
    .get(key) as
    | {
        request_hash: string;
        response_json: string;
        status_code: number;
        expires_at: string;
      }
    | undefined;

  if (existing) {
    const removed = deleteIfExpiredCompleted(
      database,
      key,
      existing.status_code,
      existing.expires_at
    );

    if (!removed) {
      if (existing.request_hash !== requestHash) {
        return { state: "conflict" };
      }

      if (!isPending(existing.status_code)) {
        return {
          state: "cached",
          statusCode: existing.status_code,
          body: JSON.parse(existing.response_json) as unknown
        };
      }

      // In-flight lock: refresh the TTL instead of letting the record expire,
      // so a slow request cannot be taken over and executed twice.
      const refreshedExpiry = new Date(Date.now() + ttl * 1000).toISOString();
      database
        .prepare(
          `UPDATE idempotency_keys
           SET expires_at = ?
           WHERE key = ? AND status_code = ?`
        )
        .run(refreshedExpiry, key, PENDING_STATUS_CODE);
      return { state: "in_progress" };
    }
  }

  const inserted = database
    .prepare(
      `INSERT OR IGNORE INTO idempotency_keys (key, request_hash, response_json, status_code, expires_at)
       VALUES (?, ?, '{}', ?, ?)`
    )
    .run(key, requestHash, PENDING_STATUS_CODE, expiresAt);

  if (inserted.changes === 1) {
    return { state: "acquired" };
  }

  return { state: "in_progress" };
}

export function releaseIdempotencyLock(key: string): void {
  const database = getSponsorshipDb();
  database
    .prepare(`DELETE FROM idempotency_keys WHERE key = ? AND status_code = ?`)
    .run(key, PENDING_STATUS_CODE);
}

export function getCachedIdempotencyResponse(
  key: string,
  requestHash: string
): CachedIdempotencyResponse | IdempotencyMiss {
  const database = getSponsorshipDb();
  const row = database
    .prepare(
      `SELECT request_hash, response_json, status_code, expires_at
       FROM idempotency_keys
       WHERE key = ?`
    )
    .get(key) as
    | {
        request_hash: string;
        response_json: string;
        status_code: number;
        expires_at: string;
      }
    | undefined;

  if (!row) {
    return { hit: false };
  }

  if (deleteIfExpiredCompleted(database, key, row.status_code, row.expires_at)) {
    return { hit: false };
  }

  // In-flight past TTL is still held — never treat as a cache miss that would
  // allow a second provider call under the same key.
  if (isPending(row.status_code) && new Date(row.expires_at).getTime() <= Date.now()) {
    if (row.request_hash !== requestHash) {
      return { hit: false, conflict: true };
    }
    return { hit: false };
  }

  if (row.request_hash !== requestHash) {
    return { hit: false, conflict: true };
  }

  if (isPending(row.status_code)) {
    return { hit: false };
  }

  return {
    hit: true,
    statusCode: row.status_code,
    body: JSON.parse(row.response_json) as unknown
  };
}

export function cacheIdempotencyResponse(
  key: string,
  requestHash: string,
  statusCode: number,
  body: unknown,
  ttl = ttlSeconds()
): void {
  const database = getSponsorshipDb();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  database
    .prepare(
      `INSERT INTO idempotency_keys (key, request_hash, response_json, status_code, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         request_hash = excluded.request_hash,
         response_json = excluded.response_json,
         status_code = excluded.status_code,
         expires_at = excluded.expires_at`
    )
    .run(key, requestHash, JSON.stringify(body), statusCode, expiresAt);
}

export function getResponseByPaymentProof(
  transactionHash: string,
  requestHash?: string
): PaymentProofLookup {
  ensurePaymentProofHashColumn();
  const database = getSponsorshipDb();
  const row = database
    .prepare(`SELECT response_json, request_hash FROM payment_proofs WHERE transaction_hash = ?`)
    .get(transactionHash) as { response_json: string; request_hash: string } | undefined;

  if (!row) {
    return { hit: false };
  }

  if (requestHash !== undefined && row.request_hash && row.request_hash !== requestHash) {
    return { hit: false, conflict: true };
  }

  return {
    hit: true,
    body: JSON.parse(row.response_json) as unknown
  };
}

export function savePaymentProofResponse(
  transactionHash: string,
  body: unknown,
  requestHash = ""
): void {
  ensurePaymentProofHashColumn();
  const database = getSponsorshipDb();
  database
    .prepare(
      `INSERT INTO payment_proofs (transaction_hash, response_json, created_at, request_hash)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(transaction_hash) DO NOTHING`
    )
    .run(transactionHash, JSON.stringify(body), new Date().toISOString(), requestHash);
}
