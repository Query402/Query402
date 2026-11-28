import express, { Router } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  METHOD_NOT_ALLOWED_BODY,
  ROUTE_NOT_FOUND_BODY,
  collectRoutes,
  createRouteFallback
} from "../lib/route-fallback.js";
import { applyApiTestEnv, resetApiTestStorage } from "../test/api-test-helpers.js";

describe("unknown routes and unsupported methods return stable JSON", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
    vi.restoreAllMocks();
  });

  async function loadApp() {
    const { app } = await import("../app.js");
    return app;
  }

  describe("404 for a path nothing defines", () => {
    it.each([
      ["an unknown /api path", "/api/does-not-exist"],
      ["an unknown /x402 path", "/x402/does-not-exist"],
      ["the bare /x402 prefix", "/x402"],
      ["the bare /api prefix", "/api"],
      ["a trailing path under a known route", "/x402/search/extra"],
      ["a nested unknown /api path", "/api/sponsorship/unknown/deeper"]
    ])("answers %s with a JSON 404", async (_label, path) => {
      const app = await loadApp();

      const response = await request(app).get(path);

      expect(response.status).toBe(404);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.body).toEqual(ROUTE_NOT_FOUND_BODY);
      expect(response.body.errorCode).toBe("route_not_found");
    });

    it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
      "answers an unknown /x402 path with a JSON 404 for %s too",
      async (method) => {
        const app = await loadApp();

        const response = await request(app)[method.toLowerCase() as "post"]("/x402/does-not-exist");

        expect(response.status).toBe(404);
        expect(response.body).toEqual(ROUTE_NOT_FOUND_BODY);
      }
    );

    it("is not answered with a payment challenge, even in demo mode", async () => {
      const app = await loadApp();

      const response = await request(app).get("/x402/does-not-exist");

      expect(response.status).not.toBe(402);
      expect(response.headers["payment-required"]).toBeUndefined();
    });

    it("never reflects the requested URL or leaks internals", async () => {
      const app = await loadApp();
      const marker = "Q402_REFLECTED_MARKER";

      const response = await request(app).get(`/api/${marker}?token=${marker}&q=${marker}`);

      const serialized = `${JSON.stringify(response.body)}\n${response.text}`;
      expect(response.status).toBe(404);
      expect(serialized).not.toContain(marker);
      expect(serialized).not.toMatch(/stack|\bat .*\(.*:\d+:\d+\)|node_modules|\.ts\b/i);
      expect(Object.keys(response.body).sort()).toEqual(["error", "errorCode", "type"]);
    });

    it("leaves paths outside /api and /x402 to the framework default", async () => {
      const app = await loadApp();

      const response = await request(app).get("/not-an-api-path");

      expect(response.status).toBe(404);
      expect(response.body).not.toEqual(ROUTE_NOT_FOUND_BODY);
    });
  });

  describe("405 for a known path asked with the wrong method", () => {
    it.each(["/x402/search", "/x402/news", "/x402/scrape", "/x402/analytics/detailed"])(
      "answers POST %s with a JSON 405 and Allow",
      async (path) => {
        const app = await loadApp();

        const response = await request(app).post(path).send({});

        expect(response.status).toBe(405);
        expect(response.headers["content-type"]).toMatch(/application\/json/);
        expect(response.headers.allow).toBe("GET, HEAD, OPTIONS");
        expect(response.body).toEqual(METHOD_NOT_ALLOWED_BODY);
        expect(response.body.errorCode).toBe("method_not_allowed");
      }
    );

    it.each(["PUT", "PATCH", "DELETE"] as const)(
      "answers %s on a paid GET route with 405",
      async (method) => {
        const app = await loadApp();

        const response = await request(app)[method.toLowerCase() as "put"]("/x402/search");

        expect(response.status).toBe(405);
        expect(response.headers.allow).toBe("GET, HEAD, OPTIONS");
      }
    );

    it("answers GET on the POST-only paid run route with 405 and Allow: OPTIONS, POST", async () => {
      const app = await loadApp();

      const response = await request(app).get("/api/paid/run");

      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("OPTIONS, POST");
      expect(response.body).toEqual(METHOD_NOT_ALLOWED_BODY);
    });

    it("answers a wrong method on a public route and a sponsorship route with 405", async () => {
      const app = await loadApp();

      const providers = await request(app).post("/api/providers").send({});
      const challenge = await request(app).get("/api/sponsorship/challenge");

      expect(providers.status).toBe(405);
      expect(providers.headers.allow).toBe("GET, HEAD, OPTIONS");
      expect(challenge.status).toBe(405);
      expect(challenge.headers.allow).toBe("OPTIONS, POST");
    });

    it("refuses the method before asking for payment", async () => {
      const app = await loadApp();

      const response = await request(app).post("/x402/search").send({});

      expect(response.status).toBe(405);
      expect(response.headers["payment-required"]).toBeUndefined();
      expect(response.body).not.toHaveProperty("accepts");
    });

    it("answers OPTIONS on a known route with 204 rather than a 404 or 405", async () => {
      const app = await loadApp();

      const response = await request(app).options("/x402/search");

      expect(response.status).toBe(204);
    });

    it("does not reflect the URL in a 405 either", async () => {
      const app = await loadApp();
      const marker = "Q402_REFLECTED_MARKER";

      const response = await request(app).post(`/x402/search?q=${marker}`).send({});

      expect(response.status).toBe(405);
      expect(`${JSON.stringify(response.body)}${response.text}`).not.toContain(marker);
    });
  });

  describe("known routes are untouched", () => {
    it("still answers a paid GET route with the payment challenge", async () => {
      const app = await loadApp();

      const response = await request(app).get("/x402/search");

      expect(response.status).toBe(402);
    });

    it("still answers HEAD on a GET route", async () => {
      const app = await loadApp();

      const response = await request(app).head("/health");

      expect(response.status).toBe(200);
    });

    it("still answers a public route", async () => {
      const app = await loadApp();

      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
    });

    it("still reaches the paid run route's own validation", async () => {
      const app = await loadApp();

      const response = await request(app).post("/api/paid/run").send({});

      expect(response.status).toBe(400);
    });
  });
});

describe("createRouteFallback", () => {
  function appWith(...routers: Router[]) {
    const app = express();
    app.use(createRouteFallback(routers));
    app.use((_req, res) => {
      res.status(200).json({ reached: true });
    });
    return app;
  }

  it("reads the route table from the routers it is given", () => {
    const router = Router();
    router.get("/api/a", (_req, res) => res.end());
    router.post("/api/a", (_req, res) => res.end());
    router.get("/api/b", (_req, res) => res.end());

    const routes = collectRoutes([router]);

    expect(routes).toHaveLength(2);
    expect(routes.find((route) => route.matcher.test("/api/a"))?.methods).toEqual(
      new Set(["GET", "POST"])
    );
  });

  it("lets a request for a defined route and method through", async () => {
    const router = Router();
    router.get("/api/a", (_req, res) => res.end());

    const response = await request(appWith(router)).get("/api/a");

    expect(response.body).toEqual({ reached: true });
  });

  it("matches routes case-insensitively and with a trailing slash, as Express does", async () => {
    const router = Router();
    router.get("/api/a", (_req, res) => res.end());

    const response = await request(appWith(router)).get("/API/A/");

    expect(response.body).toEqual({ reached: true });
  });

  it("recognises a parameterised route as known", async () => {
    const router = Router();
    router.get("/api/items/:id", (_req, res) => res.end());
    const app = appWith(router);

    const known = await request(app).get("/api/items/42");
    const wrongMethod = await request(app).delete("/api/items/42");
    const unknown = await request(app).get("/api/items");

    expect(known.body).toEqual({ reached: true });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.allow).toBe("GET, HEAD, OPTIONS");
    expect(unknown.status).toBe(404);
  });

  it("merges the methods of the same path defined in different routers", async () => {
    const first = Router();
    first.get("/api/a", (_req, res) => res.end());
    const second = Router();
    second.post("/api/a", (_req, res) => res.end());

    const response = await request(appWith(first, second)).put("/api/a");

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD, OPTIONS, POST");
  });

  it("ignores paths outside /api and /x402", async () => {
    const response = await request(appWith()).get("/elsewhere");

    expect(response.body).toEqual({ reached: true });
  });
});
