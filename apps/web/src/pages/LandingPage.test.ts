import { test, describe, before } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

// The landing page (via src/lib/api.ts) reads import.meta.env.VITE_API_BASE_URL,
// which is undefined under the Node test runner. Stub it before importing the page.
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (result.source && result.source.includes("import.meta.env")) {
      const source =
        typeof result.source === "string"
          ? result.source
          : Buffer.from(result.source).toString("utf8");
      if (source.includes("import.meta.env")) {
        result.source = source.replaceAll(
          /import\.meta\.env(\.\w+)?/g,
          '({ VITE_API_BASE_URL: "http://localhost:3001" })'
        );
      }
    }
    return result;
  }
});

const landingSource = readFileSync(
  new URL("./LandingPage.tsx", import.meta.url),
  "utf8"
);

const PROTECTED_ENDPOINTS = [
  "/x402/",
  "/api/sponsorship/preview",
  "/api/sponsorship/challenge",
  "/api/sponsorship/grants",
  "/api/paid/run"
];

const PAYMENT_HEADERS = ["X-Sponsorship-Grant", "X-Payment", "x402-"];

let LandingPage: React.ComponentType;

before(async () => {
  ({ default: LandingPage } = await import("./LandingPage.js"));
});

function renderLandingPage(): string {
  // Suppress React's expected useLayoutEffect SSR warnings (emitted via console.error).
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    return renderToString(
      React.createElement(MemoryRouter, null, React.createElement(LandingPage))
    );
  } finally {
    console.error = originalConsoleError;
  }
}

describe("LandingPage - no paid or sponsored query path", () => {
  test("does not import the payment signer (x402)", () => {
    assert.equal(
      /from\s+["'][^"']*x402(\.js)?["']/.test(landingSource),
      false,
      "LandingPage must not import the x402 payment signer"
    );
  });

  test("does not import the sponsorship grant module", () => {
    assert.equal(
      /from\s+["'][^"']*sponsorship(\.js)?["']/.test(landingSource),
      false,
      "LandingPage must not import the sponsorship grant module"
    );
  });

  test("does not reference protected or sponsorship endpoints", () => {
    for (const endpoint of PROTECTED_ENDPOINTS) {
      assert.equal(
        landingSource.includes(endpoint),
        false,
        `LandingPage must not reference protected endpoint ${endpoint}`
      );
    }
  });

  test("does not request a wallet signature", () => {
    assert.equal(
      /signMessage|signTransaction|signAuthEntry/.test(landingSource),
      false,
      "LandingPage must not request a wallet signature"
    );
  });

  test("does not render a raw payment header", () => {
    for (const header of PAYMENT_HEADERS) {
      assert.equal(
        landingSource.includes(header),
        false,
        `LandingPage must not render raw payment header ${header}`
      );
    }
  });
});

describe("LandingPage - renders without a wallet or payment client", () => {
  test("renders without a wallet", () => {
    const html = renderLandingPage();
    assert.ok(html.length > 0, "Landing page should render to non-empty HTML");
    assert.match(html, /QUERY402/);
  });

  test("does not call the payment client when rendered", () => {
    const originalFetch = globalThis.fetch;
    const calledUrls: string[] = [];
    globalThis.fetch = (input: any) => {
      calledUrls.push(String(input));
      return Promise.reject(new Error("fetch should not be called during render"));
    };

    try {
      renderLandingPage();
    } finally {
      globalThis.fetch = originalFetch;
    }

    for (const url of calledUrls) {
      for (const endpoint of PROTECTED_ENDPOINTS) {
        assert.equal(
          url.includes(endpoint),
          false,
          `Render must not call protected endpoint ${endpoint} (saw ${url})`
        );
      }
    }
  });

  test("does not render a raw payment header in the output", () => {
    const html = renderLandingPage();
    for (const header of PAYMENT_HEADERS) {
      assert.equal(
        html.includes(header),
        false,
        `Rendered HTML must not contain raw payment header ${header}`
      );
    }
  });

  test("routes paid actions to the control deck", () => {
    const html = renderLandingPage();
    assert.match(html, /href="\/control"/);
    assert.match(html, /Enter Control Deck/);
  });

  test("has no submit control that requests a signature", () => {
    const html = renderLandingPage();
    assert.equal(
      /<button[^>]*type=["']submit["']/.test(html),
      false,
      "Landing page must not render a submit button"
    );
    assert.equal(
      /<form/.test(html),
      false,
      "Landing page must not render a form"
    );
  });
});
