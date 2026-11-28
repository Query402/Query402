import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isJsonContentType,
  UNSUPPORTED_MEDIA_TYPE_BODY
} from "../lib/require-json-content-type.js";
import { applyApiTestEnv, resetApiTestStorage, TEST_WALLET } from "../test/api-test-helpers.js";

const verifyAndConsumeChallengeSpy = vi.fn();
const issueGrantSpy = vi.fn();
const previewSponsoredRunSpy = vi.fn();
const createChallengeSpy = vi.fn();

vi.mock("../lib/sponsorship/challenge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/sponsorship/challenge.js")>();
  return {
    ...actual,
    createChallenge: (...args: Parameters<typeof actual.createChallenge>) => {
      createChallengeSpy(...args);
      return actual.createChallenge(...args);
    },
    verifyAndConsumeChallenge: (...args: Parameters<typeof actual.verifyAndConsumeChallenge>) => {
      verifyAndConsumeChallengeSpy(...args);
      return actual.verifyAndConsumeChallenge(...args);
    }
  };
});

vi.mock("../lib/sponsorship/grant.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/sponsorship/grant.js")>();
  return {
    ...actual,
    issueGrant: (...args: Parameters<typeof actual.issueGrant>) => {
      issueGrantSpy(...args);
      return actual.issueGrant(...args);
    }
  };
});

vi.mock("../lib/sponsorship/policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/sponsorship/policy.js")>();
  return {
    ...actual,
    previewSponsoredRun: (...args: Parameters<typeof actual.previewSponsoredRun>) => {
      previewSponsoredRunSpy(...args);
      return actual.previewSponsoredRun(...args);
    }
  };
});

const challengeBody = { wallet: TEST_WALLET };
const grantBody = { wallet: TEST_WALLET, challengeId: randomUUID(), signature: "not-a-signature" };
const previewBody = { wallet: TEST_WALLET, mode: "search", provider: "search.basic" };

const ROUTES = [
  { name: "challenge", path: "/api/sponsorship/challenge", body: challengeBody },
  { name: "grants", path: "/api/sponsorship/grants", body: grantBody },
  { name: "preview", path: "/api/sponsorship/preview", body: previewBody }
] as const;

describe("sponsorship POST routes require application/json", () => {
  let analyticsDbPath: string;
  let sponsorshipDbPath: string;

  beforeEach(() => {
    verifyAndConsumeChallengeSpy.mockClear();
    issueGrantSpy.mockClear();
    previewSponsoredRunSpy.mockClear();
    createChallengeSpy.mockClear();
    ({ analyticsDbPath, sponsorshipDbPath } = applyApiTestEnv());
  });

  afterEach(async () => {
    await resetApiTestStorage(analyticsDbPath, sponsorshipDbPath);
  });

  async function loadApp() {
    const { app } = await import("../app.js");
    return app;
  }

  describe.each(ROUTES)("POST $path", ({ path, body }) => {
    it("accepts application/json and reaches the handler", async () => {
      const app = await loadApp();

      const response = await request(app)
        .post(path)
        .set("Content-Type", "application/json")
        .send(body);

      expect(response.status).not.toBe(415);
      expect(response.status).toBeLessThan(500);
    });

    it("accepts application/json with a UTF-8 charset", async () => {
      const app = await loadApp();

      const response = await request(app)
        .post(path)
        .set("Content-Type", "application/json; charset=utf-8")
        .send(JSON.stringify(body));

      expect(response.status).not.toBe(415);
    });

    it("refuses text/plain with a 415 and a stable code", async () => {
      const app = await loadApp();

      const response = await request(app)
        .post(path)
        .set("Content-Type", "text/plain")
        .send(JSON.stringify(body));

      expect(response.status).toBe(415);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.body).toEqual(UNSUPPORTED_MEDIA_TYPE_BODY);
      expect(response.body.errorCode).toBe("unsupported_media_type");
    });

    it("refuses a urlencoded form with a 415", async () => {
      const app = await loadApp();

      const response = await request(app).post(path).type("form").send(body);

      expect(response.status).toBe(415);
      expect(response.body).toEqual(UNSUPPORTED_MEDIA_TYPE_BODY);
    });

    it("refuses a multipart form with a 415", async () => {
      const app = await loadApp();

      const response = await request(app).post(path).field("wallet", TEST_WALLET);

      expect(response.status).toBe(415);
      expect(response.body).toEqual(UNSUPPORTED_MEDIA_TYPE_BODY);
    });

    it("refuses a request that declares no media type with a 415", async () => {
      const app = await loadApp();

      const response = await request(app).post(path).unset("Content-Type").send();

      expect(response.status).toBe(415);
      expect(response.body).toEqual(UNSUPPORTED_MEDIA_TYPE_BODY);
    });

    it.each(["application/xml", "application/vnd.api+json", "text/json"])(
      "refuses %s with a 415",
      async (contentType) => {
        const app = await loadApp();

        const response = await request(app)
          .post(path)
          .set("Content-Type", contentType)
          .send(JSON.stringify(body));

        expect(response.status).toBe(415);
        expect(response.body).toEqual(UNSUPPORTED_MEDIA_TYPE_BODY);
      }
    );

    it("does not echo the submitted media type", async () => {
      const app = await loadApp();
      const marker = "Q402_REFLECTED_TYPE";

      const response = await request(app)
        .post(path)
        .set("Content-Type", `text/${marker}`)
        .send(JSON.stringify(body));

      expect(response.status).toBe(415);
      expect(`${JSON.stringify(response.body)}${response.text}`).not.toContain(marker);
    });
  });

  describe("nothing runs for a refused body", () => {
    it("does not create a challenge", async () => {
      const app = await loadApp();

      await request(app)
        .post("/api/sponsorship/challenge")
        .set("Content-Type", "text/plain")
        .send(JSON.stringify(challengeBody));

      expect(createChallengeSpy).not.toHaveBeenCalled();
    });

    it("does not verify or consume a challenge, and does not sign a grant", async () => {
      const app = await loadApp();

      const response = await request(app)
        .post("/api/sponsorship/grants")
        .set("Content-Type", "text/plain")
        .set("Idempotency-Key", "content-type-test-key")
        .send(JSON.stringify(grantBody));

      expect(response.status).toBe(415);
      expect(verifyAndConsumeChallengeSpy).not.toHaveBeenCalled();
      expect(issueGrantSpy).not.toHaveBeenCalled();
    });

    it("does not run the sponsored-run preview", async () => {
      const app = await loadApp();

      await request(app)
        .post("/api/sponsorship/preview")
        .set("Content-Type", "text/plain")
        .send(JSON.stringify(previewBody));

      expect(previewSponsoredRunSpy).not.toHaveBeenCalled();
    });

    it("still runs them for a JSON body", async () => {
      const app = await loadApp();

      await request(app).post("/api/sponsorship/challenge").send(challengeBody);
      await request(app).post("/api/sponsorship/grants").send(grantBody);
      await request(app).post("/api/sponsorship/preview").send(previewBody);

      expect(createChallengeSpy).toHaveBeenCalledTimes(1);
      expect(verifyAndConsumeChallengeSpy).toHaveBeenCalledTimes(1);
      expect(previewSponsoredRunSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("isJsonContentType", () => {
  it.each([
    "application/json",
    "APPLICATION/JSON",
    "application/json; charset=utf-8",
    "application/json;charset=UTF-8",
    "application/json; charset=utf-16"
  ])("accepts %s", (header) => {
    expect(isJsonContentType(header)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/vnd.api+json",
    "application/jsonp",
    "text/json"
  ])("refuses %s", (header) => {
    expect(isJsonContentType(header)).toBe(false);
  });
});
