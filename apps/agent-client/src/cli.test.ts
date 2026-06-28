import { describe, expect, it } from "vitest";
import { exec } from "child_process";
import { promisify } from "util";
import { resolve } from "path";

const execAsync = promisify(exec);
// Workaround for Windows cross-platform testing
const tsx = process.platform === "win32" ? "npx.cmd tsx" : "npx tsx";
const cliPath = resolve(__dirname, "cli.ts");

describe("CLI Validation", () => {
  it("exits with clear message when query is missing for search mode", async () => {
    try {
      await execAsync(`${tsx} "${cliPath}" search`);
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Missing query for search mode.");
      expect(error.stdout).toContain("Usage:");
    }
  });

  it("exits with clear message when URL is missing for scrape mode (with flag)", async () => {
    try {
      await execAsync(`${tsx} "${cliPath}" scrape --provider scrape.page`);
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Missing URL for scrape mode.");
      expect(error.stdout).toContain("Usage:");
    }
  });

  it("exits with clear message when query is missing for news mode", async () => {
    try {
      await execAsync(`${tsx} "${cliPath}" news`);
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Missing query for news mode.");
      expect(error.stdout).toContain("Usage:");
    }
  });
});
