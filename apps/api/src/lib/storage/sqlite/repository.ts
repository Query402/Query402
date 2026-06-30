import type Database from "better-sqlite3";
import type { AnalyticsSummary, PaymentAttempt, UsageEvent } from "@query402/shared";
import { DEFAULT_RECENT_LIMIT, MAX_PAYMENT_ATTEMPTS, MAX_USAGE_EVENTS } from "../constants.js";
import {
  buildAnalyticsSummary,
  paymentAttemptToRow,
  rowToPaymentAttempt,
  rowToUsageEvent,
  usageEventToRow
} from "../serialization.js";
import type {
  AnalyticsQueryOptions,
  IdempotencyAcquireResult,
  PaginationOptions,
  PaymentUsagePair,
  StorageRepository
} from "../types.js";
import { closeAnalyticsDb, getAnalyticsDb, runInAnalyticsTransaction } from "./store.js";

const PENDING_STATUS_CODE = 0;

const INSERT_USAGE = `
INSERT INTO usage_events (
  id, mode, endpoint, provider_id, query_or_url, price_usd, network,
  payment_status, payment_kind, payment_tx_hash, asset, pay_to_address, amount,
  facilitator_url, payer_public_key, trace_id, created_at, latency_ms,
  execution_source, execution_used_fallback, execution_fallback_reason,
  execution_latency_estimate_ms, execution_observed_duration_ms,
  execution_circuit_breaker_state, sponsorship_grant_id, policy_decision,
  payment_source, sponsor_public_key
) VALUES (
  @id, @mode, @endpoint, @provider_id, @query_or_url, @price_usd, @network,
  @payment_status, @payment_kind, @payment_tx_hash, @asset, @pay_to_address, @amount,
  @facilitator_url, @payer_public_key, @trace_id, @created_at, @latency_ms,
  @execution_source, @execution_used_fallback, @execution_fallback_reason,
  @execution_latency_estimate_ms, @execution_observed_duration_ms,
  @execution_circuit_breaker_state, @sponsorship_grant_id, @policy_decision,
  @payment_source, @sponsor_public_key
)
`;

const INSERT_PAYMENT = `
INSERT INTO payment_attempts (
  id, endpoint, provider_id, amount_usd, network, asset, amount, evidence_kind,
  payer_public_key, pay_to_address, facilitator_url, status, transaction_hash,
  facilitator_result, error, created_at, sponsorship_grant_id, policy_decision,
  payment_source, sponsor_public_key
) VALUES (
  @id, @endpoint, @provider_id, @amount_usd, @network, @asset, @amount, @evidence_kind,
  @payer_public_key, @pay_to_address, @facilitator_url, @status, @transaction_hash,
  @facilitator_result, @error, @created_at, @sponsorship_grant_id, @policy_decision,
  @payment_source, @sponsor_public_key
)
`;

function trimUsageEvents(database: Database.Database): void {
  database.exec(`
    DELETE FROM usage_events
    WHERE id IN (
      SELECT id FROM usage_events
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ${MAX_USAGE_EVENTS}
    );
  `);
}

function trimPaymentAttempts(database: Database.Database): void {
  database.exec(`
    DELETE FROM payment_attempts
    WHERE id IN (
      SELECT id FROM payment_attempts
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ${MAX_PAYMENT_ATTEMPTS}
    );
  `);
}

function defer<T>(operation: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(operation());
      } catch (error) {
        reject(error);
      }
    });
  });
}

export class SqliteStorageRepository implements StorageRepository {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly dbPath: string) {}

  isAvailable(): boolean {
    try {
      getAnalyticsDb(this.dbPath);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    closeAnalyticsDb();
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.writeChain.then(operation);
    this.writeChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async saveUsageEvent(event: UsageEvent): Promise<void> {
    await this.enqueue(() =>
      defer(() =>
        runInAnalyticsTransaction(this.dbPath, (database) => {
          database.prepare(INSERT_USAGE).run(usageEventToRow(event));
          trimUsageEvents(database);
        })
      )
    );
  }

  async savePaymentAttempt(payment: PaymentAttempt): Promise<void> {
    await this.enqueue(() =>
      defer(() =>
        runInAnalyticsTransaction(this.dbPath, (database) => {
          database.prepare(INSERT_PAYMENT).run(paymentAttemptToRow(payment));
          trimPaymentAttempts(database);
        })
      )
    );
  }

  async persistPaymentAndUsage(pair: PaymentUsagePair): Promise<void> {
    await this.enqueue(() =>
      defer(() =>
        runInAnalyticsTransaction(this.dbPath, (database) => {
          database.prepare(INSERT_PAYMENT).run(paymentAttemptToRow(pair.payment));
          database.prepare(INSERT_USAGE).run(usageEventToRow(pair.usage));
          trimPaymentAttempts(database);
          trimUsageEvents(database);
        })
      )
    );
  }

  async getUsageEvents(options?: PaginationOptions): Promise<UsageEvent[]> {
    return defer(() => {
      const database = getAnalyticsDb(this.dbPath);
      const limit = options?.limit ?? MAX_USAGE_EVENTS;
      const offset = options?.offset ?? 0;

      const rows = database
        .prepare(
          `SELECT * FROM usage_events
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(limit, offset) as Record<string, unknown>[];

      return rows.map(rowToUsageEvent);
    });
  }

  async getPaymentAttempts(options?: PaginationOptions): Promise<PaymentAttempt[]> {
    return defer(() => {
      const database = getAnalyticsDb(this.dbPath);
      const limit = options?.limit ?? MAX_PAYMENT_ATTEMPTS;
      const offset = options?.offset ?? 0;

      const rows = database
        .prepare(
          `SELECT * FROM payment_attempts
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(limit, offset) as Record<string, unknown>[];

      return rows.map(rowToPaymentAttempt);
    });
  }

  async getAnalyticsSummary(options?: AnalyticsQueryOptions): Promise<AnalyticsSummary> {
    return defer(() => {
      const database = getAnalyticsDb(this.dbPath);
      const recentUsageLimit = options?.recentUsageLimit ?? DEFAULT_RECENT_LIMIT;
      const recentPaymentLimit = options?.recentPaymentLimit ?? DEFAULT_RECENT_LIMIT;

      const usageRows = database
        .prepare(`SELECT * FROM usage_events ORDER BY created_at DESC`)
        .all() as Record<string, unknown>[];
      const paymentRows = database
        .prepare(
          `SELECT * FROM payment_attempts
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(recentPaymentLimit) as Record<string, unknown>[];

      const usage = usageRows.map(rowToUsageEvent);
      const payments = paymentRows.map(rowToPaymentAttempt);

      return buildAnalyticsSummary(usage, payments, {
        recentUsageLimit,
        recentPaymentLimit
      });
    });
  }

  async acquireIdempotencyLock(
    key: string,
    requestHash: string,
    ttlSeconds: number
  ): Promise<IdempotencyAcquireResult> {
    return this.enqueue(() =>
      defer(() => {
        const database = getAnalyticsDb(this.dbPath);
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

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
          if (new Date(existing.expires_at).getTime() <= Date.now()) {
            database.prepare(`DELETE FROM idempotency_keys WHERE key = ?`).run(key);
          } else if (existing.request_hash !== requestHash) {
            return { state: "in_progress" as const };
          } else if (existing.status_code > PENDING_STATUS_CODE) {
            return {
              state: "cached" as const,
              statusCode: existing.status_code,
              body: JSON.parse(existing.response_json) as unknown
            };
          } else {
            return { state: "in_progress" as const };
          }
        }

        const inserted = database
          .prepare(
            `INSERT OR IGNORE INTO idempotency_keys (key, request_hash, response_json, status_code, expires_at)
             VALUES (?, ?, '{}', ?, ?)`
          )
          .run(key, requestHash, PENDING_STATUS_CODE, expiresAt);

        if (inserted.changes === 1) {
          return { state: "acquired" as const };
        }

        return { state: "in_progress" as const };
      })
    );
  }

  async releaseIdempotencyLock(key: string): Promise<void> {
    await this.enqueue(() =>
      defer(() => {
        const database = getAnalyticsDb(this.dbPath);
        database
          .prepare(`DELETE FROM idempotency_keys WHERE key = ? AND status_code = ?`)
          .run(key, PENDING_STATUS_CODE);
      })
    );
  }

  async cacheIdempotencyResponse(
    key: string,
    requestHash: string,
    statusCode: number,
    body: unknown,
    ttlSeconds: number
  ): Promise<void> {
    await this.enqueue(() =>
      defer(() => {
        const database = getAnalyticsDb(this.dbPath);
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

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
      })
    );
  }

  async getCachedIdempotencyResponse(
    key: string,
    requestHash: string
  ): Promise<
    { hit: true; statusCode: number; body: unknown } | { hit: false; conflict?: boolean }
  > {
    return defer(() => {
      const database = getAnalyticsDb(this.dbPath);
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
        return { hit: false as const };
      }

      if (new Date(row.expires_at).getTime() <= Date.now()) {
        database.prepare(`DELETE FROM idempotency_keys WHERE key = ?`).run(key);
        return { hit: false as const };
      }

      if (row.request_hash !== requestHash) {
        return { hit: false as const, conflict: true };
      }

      if (row.status_code <= PENDING_STATUS_CODE) {
        return { hit: false as const };
      }

      return {
        hit: true as const,
        statusCode: row.status_code,
        body: JSON.parse(row.response_json) as unknown
      };
    });
  }
}

export function createSqliteStorageRepository(dbPath: string): SqliteStorageRepository {
  return new SqliteStorageRepository(dbPath);
}
