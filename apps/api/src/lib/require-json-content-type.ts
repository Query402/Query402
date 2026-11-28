import type { NextFunction, Request, RequestHandler, Response } from "express";

export const UNSUPPORTED_MEDIA_TYPE_BODY = {
  error: "Content-Type must be application/json",
  type: "unsupported_media_type",
  errorCode: "unsupported_media_type"
} as const;

/**
 * True only when the media type is exactly `application/json` (any parameters,
 * such as `charset`, are ignored). A missing header, `text/plain`, a form type
 * or a `+json` vendor type all fail.
 */
export function isJsonContentType(header: string | undefined): boolean {
  if (!header) {
    return false;
  }

  return header.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * Rejects a request whose body is not declared as JSON with a 415 and a stable
 * error code. Mount it first on a POST route so nothing is validated, signed or
 * stored for a body the route does not accept. The response never echoes the
 * submitted media type.
 */
export function requireJsonContentType(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isJsonContentType(req.get("Content-Type"))) {
      next();
      return;
    }

    res.status(415).json(UNSUPPORTED_MEDIA_TYPE_BODY);
  };
}
