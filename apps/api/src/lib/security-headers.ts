import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Minimal permissions policy: no browser/device capability is implicitly
 * granted to responses from this API.
 */
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

/**
 * Baseline, dependency-free response-hardening headers applied to every
 * response. Only ever sets header names unrelated to CORS
 * (`Access-Control-*`) and the x402 payment headers (`payment-required`,
 * `payment-response`, `x-payment-response`), so neither is overwritten.
 */
export function securityHeaders(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    res.setHeader("X-Frame-Options", "DENY");
    next();
  };
}
