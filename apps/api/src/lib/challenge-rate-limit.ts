import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

type Window = { count: number; resetAt: number };

export type ChallengeRateLimitOptions = {
  limit: number;
  windowMs?: number;
  maxClients?: number;
  now?: () => number;
  shouldLimit?: (req: Request) => boolean;
};

export function hashClientIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier).digest("base64url");
}

export class FixedWindowRateLimiter {
  private readonly clients = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly maxClients = 10_000
  ) {}

  consume(clientKey: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const current = this.clients.get(clientKey);
    if (!current || current.resetAt <= now) {
      this.makeRoom(clientKey, now);
      this.clients.set(clientKey, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000))
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private makeRoom(incomingKey: string, now: number) {
    if (this.clients.has(incomingKey)) return;

    for (const [key, value] of this.clients) {
      if (value.resetAt <= now) this.clients.delete(key);
    }

    while (this.clients.size >= this.maxClients) {
      const oldestKey = this.clients.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.clients.delete(oldestKey);
    }
  }
}

function clientKey(req: Request): string {
  return hashClientIdentifier(req.ip || req.socket.remoteAddress || "unknown-client");
}

export function createChallengeRateLimit(options: ChallengeRateLimitOptions): RequestHandler {
  const limiter = new FixedWindowRateLimiter(options.limit, options.windowMs, options.maxClients);

  return (req: Request, res: Response, next: NextFunction) => {
    if (options.shouldLimit && !options.shouldLimit(req)) return next();

    const result = limiter.consume(clientKey(req), options.now?.());
    if (result.allowed) return next();

    res.set("Retry-After", String(result.retryAfterSeconds));
    return res.status(429).json({
      error: "Too many challenge requests",
      errorCode: "rate_limited"
    });
  };
}

const PAYMENT_HEADERS = ["payment", "payment-signature", "x-payment"];

export function isUnpaidX402Request(req: Request): boolean {
  if (!req.path.startsWith("/x402/")) return false;
  if (req.get("x-query402-demo-paid") === "true") return false;
  return !PAYMENT_HEADERS.some((header) => req.get(header));
}
