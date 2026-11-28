import type { NextFunction, Request, RequestHandler, Response, Router } from "express";

/**
 * Stable JSON for requests that match no route, so agent clients never have to
 * parse a framework HTML page to classify the failure.
 *
 * The body is a constant on purpose: it never repeats the request path, query
 * or method, and no error object is involved, so nothing reflected or internal
 * can leak through it.
 */
export const ROUTE_NOT_FOUND_BODY = {
  error: "Route not found",
  type: "route_not_found",
  errorCode: "route_not_found"
} as const;

export const METHOD_NOT_ALLOWED_BODY = {
  error: "Method not allowed",
  type: "method_not_allowed",
  errorCode: "method_not_allowed"
} as const;

/** Only these path trees are owned by the API contract and answered in JSON. */
const API_PREFIXES = ["/api", "/x402"] as const;

type RouteEntry = { matcher: RegExp; methods: Set<string> };

function isUnderApiPrefix(path: string): boolean {
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Routes here are literal paths; a `:name` segment is the only pattern form
// supported so a parameterised route added later is still recognised as known.
function pathToMatcher(path: string): RegExp {
  const source = path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]+" : escapeRegExp(segment)))
    .join("/");
  return new RegExp(`^${source}/?$`, "i");
}

/**
 * Reads the route table from the routers themselves, so a route added to a
 * router is known here without a second list to keep in sync.
 */
export function collectRoutes(routers: Router[]): RouteEntry[] {
  const entries = new Map<string, RouteEntry>();

  for (const router of routers) {
    for (const layer of router.stack as Array<{
      route?: { path: unknown; methods: Record<string, boolean> };
    }>) {
      const route = layer.route;
      if (!route || typeof route.path !== "string") {
        continue;
      }

      const entry = entries.get(route.path) ?? {
        matcher: pathToMatcher(route.path),
        methods: new Set<string>()
      };
      for (const [method, enabled] of Object.entries(route.methods)) {
        if (enabled) {
          entry.methods.add(method.toUpperCase());
        }
      }
      entries.set(route.path, entry);
    }
  }

  return [...entries.values()];
}

function allowHeader(methods: Set<string>): string {
  const allowed = new Set(methods);
  // Express answers HEAD from a GET handler, and OPTIONS is answered here.
  if (allowed.has("GET")) {
    allowed.add("HEAD");
  }
  allowed.add("OPTIONS");
  return [...allowed].sort().join(", ");
}

/**
 * Answers requests under /api and /x402 that cannot reach a handler:
 *
 * - a path no router defines gets a JSON 404 `route_not_found`;
 * - a path that exists, asked with a method it does not define, gets a JSON
 *   405 `method_not_allowed` with an `Allow` header.
 *
 * Mount it before anything that would act on those paths (the payment
 * challenge, rate limits), so an unknown or wrongly-methoded request is never
 * answered with a 402 or counted against a client. Requests that do match a
 * route fall through untouched.
 */
export function createRouteFallback(routers: Router[]): RequestHandler {
  const routes = collectRoutes(routers);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!isUnderApiPrefix(req.path)) {
      next();
      return;
    }

    const matching = routes.filter((route) => route.matcher.test(req.path));
    if (matching.length === 0) {
      res.status(404).json(ROUTE_NOT_FOUND_BODY);
      return;
    }

    const methods = new Set(matching.flatMap((route) => [...route.methods]));
    const method = req.method.toUpperCase();
    const handled = methods.has(method) || (method === "HEAD" && methods.has("GET"));

    if (handled) {
      next();
      return;
    }

    res.set("Allow", allowHeader(methods));
    if (method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    res.status(405).json(METHOD_NOT_ALLOWED_BODY);
  };
}
