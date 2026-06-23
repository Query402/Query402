import assert from "node:assert/strict";
import test from "node:test";
import { UnsafeScrapeUrlError } from "../lib/scrape-url-safety.js";

test("executeQuery rejects unsafe scrape URLs at the service boundary", async () => {
  process.env.X402_PAY_TO_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const { executeQuery } = await import("./query-service.js");

  await assert.rejects(
    () =>
      executeQuery({
        mode: "scrape",
        provider: "scrape.page",
        url: "http://169.254.169.254/latest/meta-data"
      }),
    UnsafeScrapeUrlError
  );
});
