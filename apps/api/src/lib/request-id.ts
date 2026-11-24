import { nanoid } from "nanoid";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger.js";

/**
 * Inbound request correlation IDs.
 *
 * Clients may supply `x-request-id` to correlate their own traces with ours.
 * The value is untrusted: it is echoed into response headers and structured
 * logs, so it must be bounded and free of control characters. See
 * `docs/request-ids.md` for the documented policy.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/** Maximum accepted length of a client-supplied request ID. */
export const MAX_REQUEST_ID_LENGTH = 128;

/** Only printable, log-safe ASCII is accepted: letters, digits, `.`, `_`, `:`, `-`. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type RequestIdSource = "client" | "generated";

export type RequestIdRejectionReason = "too_long" | "invalid_characters";

export interface ResolvedRequestId {
  requestId: string;
  source: RequestIdSource;
  /** Present only when a client value was supplied but discarded. */
  rejectionReason?: RequestIdRejectionReason;
}

/** Generates a server-owned request ID that always satisfies the accepted policy. */
export function generateRequestId(): string {
  return `req_${nanoid(21)}`;
}

/**
 * Resolves the effective request ID for an inbound request.
 *
 * A valid client value is echoed as-is; anything missing, oversized or
 * containing control/unsafe characters is replaced by a generated ID.
 */
export function resolveRequestId(rawValue: string | string[] | undefined): ResolvedRequestId {
  if (rawValue === undefined || rawValue === "") {
    return { requestId: generateRequestId(), source: "generated" };
  }

  if (Array.isArray(rawValue)) {
    return {
      requestId: generateRequestId(),
      source: "generated",
      rejectionReason: "invalid_characters"
    };
  }

  if (rawValue.length > MAX_REQUEST_ID_LENGTH) {
    return {
      requestId: generateRequestId(),
      source: "generated",
      rejectionReason: "too_long"
    };
  }

  if (!REQUEST_ID_PATTERN.test(rawValue)) {
    return {
      requestId: generateRequestId(),
      source: "generated",
      rejectionReason: "invalid_characters"
    };
  }

  return { requestId: rawValue, source: "client" };
}

/**
 * Express middleware that resolves the inbound request ID, exposes it on
 * `res.locals.requestId`, and mirrors it back in the response header.
 */
export function createRequestIdMiddleware() {
  return function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
    const resolved = resolveRequestId(req.headers[REQUEST_ID_HEADER]);

    res.locals.requestId = resolved.requestId;
    res.locals.requestIdSource = resolved.source;
    res.setHeader(REQUEST_ID_HEADER, resolved.requestId);

    if (resolved.rejectionReason) {
      logger.warn(
        {
          requestId: resolved.requestId,
          requestIdSource: resolved.source,
          rejectionReason: resolved.rejectionReason,
          method: req.method,
          url: req.url
        },
        "discarded invalid inbound request id"
      );
    }

    next();
  };
}
