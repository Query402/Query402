import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createChallengeRateLimit,
  FixedWindowRateLimiter,
  hashClientIdentifier
} from "./challenge-rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the limit and resets after the window", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000, 10);

    expect(limiter.consume("client-a", 0).allowed).toBe(true);
    expect(limiter.consume("client-a", 1).allowed).toBe(true);
    expect(limiter.consume("client-a", 2)).toEqual({
      allowed: false,
      retryAfterSeconds: 1
    });
    expect(limiter.consume("client-a", 1_000).allowed).toBe(true);
  });

  it("keeps client windows separate", () => {
    const limiter = new FixedWindowRateLimiter(1);

    expect(limiter.consume("client-a", 0).allowed).toBe(true);
    expect(limiter.consume("client-a", 1).allowed).toBe(false);
    expect(limiter.consume("client-b", 1).allowed).toBe(true);
  });

  it("hashes client identifiers before storage", () => {
    const raw = "203.0.113.10";
    expect(hashClientIdentifier(raw)).not.toContain(raw);
    expect(hashClientIdentifier(raw)).toBe(hashClientIdentifier(raw));
  });
});

describe("challenge rate-limit middleware", () => {
  it("returns a stable 429 response with Retry-After", async () => {
    const app = express();
    app.use(createChallengeRateLimit({ limit: 1, now: () => 0 }));
    app.get("/challenge", (_req, res) => res.sendStatus(204));

    await request(app).get("/challenge").expect(204);
    const response = await request(app).get("/challenge").expect(429);

    expect(response.headers["retry-after"]).toBe("60");
    expect(response.body).toEqual({
      error: "Too many challenge requests",
      errorCode: "rate_limited"
    });
  });

  it("does not affect requests excluded by the route predicate", async () => {
    const app = express();
    app.use(
      createChallengeRateLimit({
        limit: 1,
        now: () => 0,
        shouldLimit: (req) => req.path === "/challenge"
      })
    );
    app.get("/health", (_req, res) => res.sendStatus(204));

    await request(app).get("/health").expect(204);
    await request(app).get("/health").expect(204);
  });
});
