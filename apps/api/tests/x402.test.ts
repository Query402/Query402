import "./setup.js";
import test from "node:test";
import assert from "node:assert";
import { saveUsageEvent, getPaymentAttempts, getUsageEvents } from "../src/lib/persistence.js";
import { getX402LifecycleHandlers } from "../src/lib/x402.js";
import { config } from "../src/lib/config.js";

test("evidence pipeline updates correctly on settlement", async (t) => {
  const req = {
    path: "/x402/search",
    headers: {} as Record<string, string>
  };

  const verifyCtx = {
    transportContext: {
      req,
      request: req,
      adapter: { getQueryParam: (key: string) => (key === "provider" ? "search.basic" : undefined) }
    },
    requirements: { amount: "0.01", payTo: "G..." },
    paymentPayload: "raw_header"
  };

  const handlers = getX402LifecycleHandlers(config.STELLAR_NETWORK as string);

  // 1. Simulate onAfterVerify which creates the payment attempt
  await handlers.onAfterVerify(verifyCtx);

  const paymentId = req.headers["x-payment-attempt-id"];
  assert.ok(paymentId, "onAfterVerify should set x-payment-attempt-id");

  const paymentAfterVerify = getPaymentAttempts().find((p) => p.id === paymentId);
  assert.strictEqual(paymentAfterVerify?.evidence.status, "verified");

  // 2. Simulate the endpoint handler persisting the usage event
  const traceId = "trace_test_456";
  saveUsageEvent({
    id: "use_test_123",
    mode: "search",
    endpoint: "/x402/search",
    providerId: "search.basic",
    queryOrUrl: "test",
    priceUsd: 0.01,
    evidence: paymentAfterVerify.evidence,
    traceId,
    paymentId,
    createdAt: new Date().toISOString(),
    latencyMs: 100
  });

  const usageAfterVerify = getUsageEvents().find((u) => u.traceId === traceId);
  assert.strictEqual(usageAfterVerify?.evidence.status, "verified");

  // 3. Simulate onAfterSettle updating the payment
  const settleCtx = {
    transportContext: { req, request: req },
    requirements: { amount: "0.01", payTo: "G..." },
    result: { transaction: "tx_hash_123" },
    paymentPayload: "raw_header"
  };

  await handlers.onAfterSettle(settleCtx);

  const paymentAfterSettle = getPaymentAttempts().find((p) => p.id === paymentId);
  const usageAfterSettle = getUsageEvents().find((u) => u.traceId === traceId);

  assert.strictEqual(paymentAfterSettle?.evidence.status, "settled");
  if (paymentAfterSettle?.evidence.status === "settled") {
    assert.strictEqual(paymentAfterSettle.evidence.transactionHash, "tx_hash_123");
  }

  assert.strictEqual(usageAfterSettle?.evidence.status, "settled");
  if (usageAfterSettle?.evidence.status === "settled") {
    assert.strictEqual(usageAfterSettle.evidence.transactionHash, "tx_hash_123");
  }
});

test("evidence pipeline updates correctly on failure", async (t) => {
  const req = {
    path: "/x402/news",
    headers: {} as Record<string, string>
  };

  const verifyCtx = {
    transportContext: {
      req,
      request: req,
      adapter: { getQueryParam: (key: string) => (key === "provider" ? "news.basic" : undefined) }
    },
    requirements: { amount: "0.015", payTo: "G..." },
    paymentPayload: "raw_header_2"
  };

  const handlers = getX402LifecycleHandlers(config.STELLAR_NETWORK as string);

  // 1. Simulate onAfterVerify which creates the payment attempt
  await handlers.onAfterVerify(verifyCtx);

  const paymentId = req.headers["x-payment-attempt-id"];
  assert.ok(paymentId, "onAfterVerify should set x-payment-attempt-id");

  const paymentAfterVerify = getPaymentAttempts().find((p) => p.id === paymentId);
  assert.strictEqual(paymentAfterVerify?.evidence.status, "verified");

  // 2. Simulate the endpoint handler persisting the usage event
  const traceId = "trace_test_789";
  saveUsageEvent({
    id: "use_test_456",
    mode: "news",
    endpoint: "/x402/news",
    providerId: "news.basic",
    queryOrUrl: "test",
    priceUsd: 0.015,
    evidence: paymentAfterVerify.evidence,
    traceId,
    paymentId,
    createdAt: new Date().toISOString(),
    latencyMs: 120
  });

  // 3. Simulate onSettleFailure updating the payment and usage
  const failCtx = {
    transportContext: { req, request: req },
    requirements: { amount: "0.015", payTo: "G..." },
    error: new Error("Insufficient funds"),
    paymentPayload: "raw_header_2"
  };

  await handlers.onSettleFailure(failCtx);

  const paymentAfterFail = getPaymentAttempts().find((p) => p.id === paymentId);
  const usageAfterFail = getUsageEvents().find((u) => u.traceId === traceId);

  assert.strictEqual(paymentAfterFail?.evidence.status, "failed");
  if (paymentAfterFail?.evidence.status === "failed") {
    assert.strictEqual(paymentAfterFail.evidence.error, "Insufficient funds");
  }

  assert.strictEqual(usageAfterFail?.evidence.status, "failed");
  if (usageAfterFail?.evidence.status === "failed") {
    assert.strictEqual(usageAfterFail.evidence.error, "Insufficient funds");
  }
});

test("proof that forged demo headers cannot bypass real verification when demoMode is false", async (t) => {
  const originalDemoMode = config.demoMode;
  config.demoMode = false;

  // create middleware
  const { createX402Middleware } = await import("../src/lib/x402.js");
  const middleware = createX402Middleware();

  const req = {
    method: "GET",
    path: "/x402/search",
    header: (k: string) => {
      if (k === "x-query402-demo-paid") return "true";
      if (k === "payment-response") return "demo_tx_forged";
      return undefined;
    },
    headers: {},
    query: { provider: "search.basic" }
  };

  let statusCode = 200;
  let jsonResponse: any = null;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return {
        json: (data: any) => {
          jsonResponse = data;
        }
      };
    }
  };

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await new Promise<void>((resolve) => {
    // Cast middleware to handle our mock req/res
    (middleware as any)(req, res, () => {
      nextCalled = true;
      resolve();
    });
    // the real middleware will likely call res.status(402).json(...) synchronously or async
    setTimeout(resolve, 50);
  });

  assert.strictEqual(
    nextCalled,
    false,
    "Should not call next() for real verification with forged headers"
  );
  assert.strictEqual(statusCode, 402, "Should return 402 Payment Required");
  assert.ok(jsonResponse?.error === "Payment Required", "Should require payment");

  config.demoMode = originalDemoMode;
});

test("demo flow creates demo-paid attempt when demoMode is true", async (t) => {
  const originalDemoMode = config.demoMode;
  config.demoMode = true;

  const { createX402Middleware } = await import("../src/lib/x402.js");
  const middleware = createX402Middleware();

  const req = {
    method: "GET",
    path: "/x402/news",
    header: (k: string) => {
      if (k === "x-query402-demo-paid") return "true";
      if (k === "payment-response") return "demo_tx_123";
      return undefined;
    },
    headers: {},
    query: { provider: "news.basic" }
  };

  const res = {};
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  (middleware as any)(req, res, next);

  assert.strictEqual(nextCalled, true, "Should call next() in demo mode with headers");

  const paymentId = (req.headers as any)["x-payment-attempt-id"];
  assert.ok(paymentId, "Should generate a payment attempt ID");

  const payment = getPaymentAttempts().find((p) => p.id === paymentId);
  assert.ok(payment, "Payment attempt should be saved");
  assert.strictEqual(payment?.evidence.status, "demo-paid");
  if (payment?.evidence.status === "demo-paid") {
    assert.strictEqual(payment.evidence.demoId, "demo_tx_123");
  }

  config.demoMode = originalDemoMode;
});
