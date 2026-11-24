import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PAYMENT_ATTEMPTS, MAX_USAGE_EVENTS } from "./constants.js";
import { createInMemoryStorageRepository } from "./memory.js";
import { resolveApiDataPath } from "./paths.js";
import { buildTestPaymentAttempt, buildTestUsageEvent } from "../../test/storage-test-helpers.js";

describe("storage paths", () => {
  it("resolves relative data paths from the API package root", () => {
    const resolved = resolveApiDataPath("data/analytics.db");
    expect(resolved).toMatch(/apps[/\\]api[/\\]data[/\\]analytics\.db$/);
    expect(resolved).not.toContain(`${path.sep}src${path.sep}data${path.sep}`);
  });
});

describe("InMemoryStorageRepository", () => {
  let repository = createInMemoryStorageRepository();

  afterEach(() => {
    repository.close();
    repository = createInMemoryStorageRepository();
  });

  it("starts empty and returns zeroed analytics", async () => {
    const summary = await repository.getAnalyticsSummary();

    expect(summary.totalQueries).toBe(0);
    expect(summary.totalSpendUsd).toBe(0);
    expect(summary.settledSpendUsd).toBe(0);
    expect(summary.demoSpendUsd).toBe(0);
    expect(summary.failedSpendUsd).toBe(0);
    expect(summary.recentUsage).toEqual([]);
    expect(summary.recentTransactions).toEqual([]);
  });

  it("persists payment and usage atomically", async () => {
    const payment = buildTestPaymentAttempt();
    const usage = buildTestUsageEvent({ id: "use_pair_1" });

    await repository.persistPaymentAndUsage({ payment, usage });

    expect(await repository.getPaymentAttempts()).toHaveLength(1);
    expect(await repository.getUsageEvents()).toHaveLength(1);
  });

  it("handles concurrent writes without losing records", async () => {
    const writes = Array.from({ length: 40 }, (_, index) =>
      repository.persistPaymentAndUsage({
        payment: buildTestPaymentAttempt({ id: `pay_concurrent_${index}` }),
        usage: buildTestUsageEvent({ id: `use_concurrent_${index}` })
      })
    );

    await Promise.all(writes);

    expect(await repository.getUsageEvents()).toHaveLength(40);
    expect(await repository.getPaymentAttempts()).toHaveLength(40);
  });

  it("enforces bounded retention for usage and payments", async () => {
    for (let index = 0; index < MAX_USAGE_EVENTS + 5; index += 1) {
      await repository.saveUsageEvent(buildTestUsageEvent({ id: `use_bound_${index}` }));
    }

    for (let index = 0; index < MAX_PAYMENT_ATTEMPTS + 5; index += 1) {
      await repository.savePaymentAttempt(buildTestPaymentAttempt({ id: `pay_bound_${index}` }));
    }

    expect(await repository.getUsageEvents()).toHaveLength(MAX_USAGE_EVENTS);
    expect(await repository.getPaymentAttempts()).toHaveLength(MAX_PAYMENT_ATTEMPTS);
  });

  it("deduplicates idempotency keys and returns cached responses", async () => {
    const first = await repository.acquireIdempotencyLock("key-1", "hash-a", 300);
    expect(first.state).toBe("acquired");

    const second = await repository.acquireIdempotencyLock("key-1", "hash-a", 300);
    expect(second.state).toBe("in_progress");

    await repository.cacheIdempotencyResponse("key-1", "hash-a", 200, { ok: true }, 300);

    const cached = await repository.getCachedIdempotencyResponse("key-1", "hash-a");
    expect(cached.hit).toBe(true);
    if (cached.hit) {
      expect(cached.statusCode).toBe(200);
      expect(cached.body).toEqual({ ok: true });
    }
  });
});
