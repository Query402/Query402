import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  JsonMigrationCollisionError,
  migrateLegacyJsonToSqlite,
  parseLegacyDbJson
} from "../migrate-json.js";
import { createSqliteStorageRepository } from "./repository.js";
import { closeAnalyticsDb, getAnalyticsDb, runInAnalyticsTransaction } from "./store.js";
import { MAX_PAYMENT_ATTEMPTS, MAX_USAGE_EVENTS } from "../constants.js";
import { paymentAttemptToRow, usageEventToRow } from "../serialization.js";
import {
  buildLegacyDbFixture,
  buildTestPaymentAttempt,
  buildTestUsageEvent,
  createTempAnalyticsDbPath,
  createTempJsonPath,
  resetAnalyticsStore
} from "../../../test/storage-test-helpers.js";

describe("SqliteStorageRepository", () => {
  let dbPath = createTempAnalyticsDbPath();

  afterEach(async () => {
    await resetAnalyticsStore(dbPath);
    dbPath = createTempAnalyticsDbPath();
  });

  it("starts empty on a new database file", async () => {
    const repository = createSqliteStorageRepository(dbPath);
    const summary = await repository.getAnalyticsSummary();

    expect(summary.totalQueries).toBe(0);
    expect(summary.totalSpendUsd).toBe(0);
    expect(fs.existsSync(dbPath)).toBe(true);
    repository.close();
  });

  it("persists records across repository restarts", async () => {
    const payment = buildTestPaymentAttempt({ id: "pay_restart_1" });
    const usage = buildTestUsageEvent({ id: "use_restart_1" });

    const writer = createSqliteStorageRepository(dbPath);
    await writer.persistPaymentAndUsage({ payment, usage });
    writer.close();

    const reader = createSqliteStorageRepository(dbPath);
    const usageEvents = await reader.getUsageEvents();
    const payments = await reader.getPaymentAttempts();

    expect(usageEvents).toHaveLength(1);
    expect(payments).toHaveLength(1);
    expect(usageEvents[0]?.id).toBe("use_restart_1");
    expect(payments[0]?.id).toBe("pay_restart_1");
    reader.close();
  });

  it("keeps all concurrent writes without losing records", async () => {
    const repository = createSqliteStorageRepository(dbPath);

    const writes = Array.from({ length: 50 }, (_, index) =>
      repository.persistPaymentAndUsage({
        payment: buildTestPaymentAttempt({ id: `pay_race_${index}` }),
        usage: buildTestUsageEvent({ id: `use_race_${index}` })
      })
    );

    await Promise.all(writes);

    expect(await repository.getUsageEvents()).toHaveLength(50);
    expect(await repository.getPaymentAttempts()).toHaveLength(50);
    repository.close();
  });

  it("rolls back failed atomic payment+usage transactions", () => {
    const payment = buildTestPaymentAttempt({ id: "pay_rollback_1" });
    const usage = buildTestUsageEvent({ id: "use_rollback_1" });

    expect(() =>
      runInAnalyticsTransaction(dbPath, (database) => {
        database
          .prepare(
            `
          INSERT INTO payment_attempts (
            id, endpoint, provider_id, amount_usd, network, payer_public_key,
            pay_to_address, facilitator_url, status, transaction_hash, error,
            created_at, sponsorship_grant_id, policy_decision, payment_source, sponsor_public_key
          ) VALUES (
            @id, @endpoint, @provider_id, @amount_usd, @network, @payer_public_key,
            @pay_to_address, @facilitator_url, @status, @transaction_hash, @error,
            @created_at, @sponsorship_grant_id, @policy_decision, @payment_source, @sponsor_public_key
          )
        `
          )
          .run(paymentAttemptToRow(payment));
        database
          .prepare(
            `
          INSERT INTO usage_events (
            id, mode, endpoint, provider_id, query_or_url, price_usd, network,
            payment_status, payment_tx_hash, facilitator_url, payer_public_key,
            trace_id, created_at, latency_ms, sponsorship_grant_id, policy_decision,
            payment_source, sponsor_public_key
          ) VALUES (
            @id, @mode, @endpoint, @provider_id, @query_or_url, @price_usd, @network,
            @payment_status, @payment_tx_hash, @facilitator_url, @payer_public_key,
            @trace_id, @created_at, @latency_ms, @sponsorship_grant_id, @policy_decision,
            @payment_source, @sponsor_public_key
          )
        `
          )
          .run(usageEventToRow(usage));
        throw new Error("forced rollback");
      })
    ).toThrow("forced rollback");

    const database = getAnalyticsDb(dbPath);
    const usageCount = (
      database.prepare(`SELECT COUNT(*) AS count FROM usage_events`).get() as { count: number }
    ).count;
    const paymentCount = (
      database.prepare(`SELECT COUNT(*) AS count FROM payment_attempts`).get() as { count: number }
    ).count;

    expect(usageCount).toBe(0);
    expect(paymentCount).toBe(0);
    closeAnalyticsDb();
  });

  it("enforces unique payment transaction hashes", async () => {
    const repository = createSqliteStorageRepository(dbPath);
    const sharedHash = "tx_unique_hash_1";

    await repository.persistPaymentAndUsage({
      payment: buildTestPaymentAttempt({ id: "pay_unique_1", transactionHash: sharedHash }),
      usage: buildTestUsageEvent({ id: "use_unique_1" })
    });

    await expect(
      repository.persistPaymentAndUsage({
        payment: buildTestPaymentAttempt({ id: "pay_unique_2", transactionHash: sharedHash }),
        usage: buildTestUsageEvent({ id: "use_unique_2" })
      })
    ).rejects.toThrow();

    expect(await repository.getPaymentAttempts()).toHaveLength(1);
    expect(await repository.getUsageEvents()).toHaveLength(1);
    repository.close();
  });

  it("trims usage and payment history to configured bounds", async () => {
    const repository = createSqliteStorageRepository(dbPath);

    for (let index = 0; index < MAX_USAGE_EVENTS + 3; index += 1) {
      await repository.saveUsageEvent(buildTestUsageEvent({ id: `use_trim_${index}` }));
    }

    for (let index = 0; index < MAX_PAYMENT_ATTEMPTS + 3; index += 1) {
      await repository.savePaymentAttempt(buildTestPaymentAttempt({ id: `pay_trim_${index}` }));
    }

    expect(await repository.getUsageEvents()).toHaveLength(MAX_USAGE_EVENTS);
    expect(await repository.getPaymentAttempts()).toHaveLength(MAX_PAYMENT_ATTEMPTS);
    repository.close();
  });
});

function captureMigrationError(options: { sourcePath: string; targetPath: string }): string {
  try {
    migrateLegacyJsonToSqlite(options);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("legacy db.json migration", () => {
  let sourcePath = createTempJsonPath();
  let targetPath = createTempAnalyticsDbPath();

  afterEach(async () => {
    if (fs.existsSync(sourcePath)) {
      fs.rmSync(sourcePath, { force: true });
    }

    for (const archived of fs
      .readdirSync("/tmp")
      .filter((name) => name.startsWith("query402-legacy-"))) {
      fs.rmSync(`/tmp/${archived}`, { force: true });
    }

    await resetAnalyticsStore(targetPath);
    sourcePath = createTempJsonPath();
    targetPath = createTempAnalyticsDbPath();
  });

  it("parses and migrates the legacy db.json fixture shape", async () => {
    const fixture = buildLegacyDbFixture();
    fs.writeFileSync(sourcePath, JSON.stringify(fixture, null, 2));

    const parsed = parseLegacyDbJson(JSON.stringify(fixture));
    expect(parsed.usage).toHaveLength(1);
    expect(parsed.payments).toHaveLength(1);

    const result = migrateLegacyJsonToSqlite({ sourcePath, targetPath });
    expect(result.usageInserted).toBe(1);
    expect(result.paymentsInserted).toBe(1);

    const repository = createSqliteStorageRepository(targetPath);
    expect(await repository.getUsageEvents()).toHaveLength(1);
    expect(await repository.getPaymentAttempts()).toHaveLength(1);
    repository.close();
  });

  it("rejects a duplicate idempotency key inside the file and imports nothing", async () => {
    const fixture = buildLegacyDbFixture();
    fixture.usage.push({ ...fixture.usage[0] });
    fs.writeFileSync(sourcePath, JSON.stringify(fixture, null, 2));

    const seed = createSqliteStorageRepository(targetPath);
    expect(await seed.getUsageEvents()).toHaveLength(0);
    seed.close();
    expect(fs.existsSync(targetPath)).toBe(true);

    expect(() => migrateLegacyJsonToSqlite({ sourcePath, targetPath })).toThrow(
      JsonMigrationCollisionError
    );

    const repository = createSqliteStorageRepository(targetPath);
    expect(await repository.getUsageEvents()).toHaveLength(0);
    expect(await repository.getPaymentAttempts()).toHaveLength(0);
    repository.close();
  });

  it("rejects a duplicate payment reference inside the file without echoing it", async () => {
    const fixture = buildLegacyDbFixture();
    const paymentReference = fixture.payments[0].transactionHash ?? "";
    expect(paymentReference.length).toBeGreaterThan(0);

    fixture.payments.push({ ...fixture.payments[0], id: "pay_legacy_2" });
    fs.writeFileSync(sourcePath, JSON.stringify(fixture, null, 2));

    const message = captureMigrationError({ sourcePath, targetPath });

    expect(message).toMatch(/duplicate payment reference/);
    expect(message).not.toContain(paymentReference);
    expect(message).not.toContain("payment-response");

    const repository = createSqliteStorageRepository(targetPath);
    expect(await repository.getUsageEvents()).toHaveLength(0);
    expect(await repository.getPaymentAttempts()).toHaveLength(0);
    repository.close();
  });

  it("rejects a duplicate usage payment reference inside the file", () => {
    const fixture = buildLegacyDbFixture();
    const usageReference = fixture.payments[0].transactionHash ?? "";
    expect(usageReference.length).toBeGreaterThan(0);

    fixture.usage[0].paymentTxHash = usageReference;
    fixture.usage.push({ ...fixture.usage[0], id: "use_legacy_2" });
    fs.writeFileSync(sourcePath, JSON.stringify(fixture, null, 2));

    const message = captureMigrationError({ sourcePath, targetPath });

    expect(message).toMatch(/duplicate payment reference/);
    expect(message).not.toContain(usageReference);
  });

  it("rejects a key that already exists in SQLite and leaves the database unchanged", async () => {
    const fixture = buildLegacyDbFixture();
    fs.writeFileSync(sourcePath, JSON.stringify(fixture, null, 2));

    const first = migrateLegacyJsonToSqlite({ sourcePath, targetPath });
    expect(first.usageInserted).toBe(1);
    expect(first.paymentsInserted).toBe(1);

    const paymentReference = fixture.payments[0].transactionHash ?? "";
    expect(paymentReference.length).toBeGreaterThan(0);
    const message = captureMigrationError({ sourcePath, targetPath });

    expect(message).toMatch(/already exists in target database/);
    expect(message).not.toContain(paymentReference);

    const repository = createSqliteStorageRepository(targetPath);
    expect(await repository.getUsageEvents()).toHaveLength(1);
    expect(await repository.getPaymentAttempts()).toHaveLength(1);
    repository.close();
  });

  it("rejects a payment reference that already exists in SQLite and imports nothing", async () => {
    const fixture = buildLegacyDbFixture();
    fs.writeFileSync(sourcePath, JSON.stringify(fixture, null, 2));
    migrateLegacyJsonToSqlite({ sourcePath, targetPath });

    // Disjoint ids, but the same on-chain payment reference as the first file.
    const second = buildLegacyDbFixture();
    second.usage[0].id = "use_legacy_2";
    second.payments[0].id = "pay_legacy_2";
    const paymentReference = second.payments[0].transactionHash ?? "";
    expect(paymentReference.length).toBeGreaterThan(0);
    fs.writeFileSync(sourcePath, JSON.stringify(second, null, 2));

    const message = captureMigrationError({ sourcePath, targetPath });

    expect(message).toMatch(/payment reference for payment "pay_legacy_2"/);
    expect(message).not.toContain(paymentReference);

    const repository = createSqliteStorageRepository(targetPath);
    const usageEvents = await repository.getUsageEvents();
    const payments = await repository.getPaymentAttempts();
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]?.id).toBe("use_legacy_1");
    expect(payments).toHaveLength(1);
    expect(payments[0]?.id).toBe("pay_legacy_1");
    repository.close();
  });
});
