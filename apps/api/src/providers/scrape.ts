import { ProviderResultItem } from "@query402/shared";
import { ProviderAdapter, PaidQueryContext } from "./core.js";
import { fetchGroqItems } from "../lib/groq.js";
import { validateUrl } from "../lib/urlSafety.js";
import { validateScrapeUrl } from "../lib/scrape-url-safety.js";

const UNSAFE_SCRAPE_TARGET = "Unsafe scrape target";

function assertSafeTarget(targetUrl: string): void {
  if (!validateUrl(targetUrl).safe) {
    throw new Error(UNSAFE_SCRAPE_TARGET);
  }
}

async function assertSafeScrapeTarget(targetUrl: string): Promise<void> {
  assertSafeTarget(targetUrl);
  try {
    await validateScrapeUrl(targetUrl);
  } catch {
    throw new Error(UNSAFE_SCRAPE_TARGET);
  }
}

function buildScrapeItems(targetUrl: string): ProviderResultItem[] {
  const hostname = (() => {
    try {
      return new URL(targetUrl).hostname.replace(/^www\./, "");
    } catch {
      return "target site";
    }
  })();

  return [
    {
      title: "Page title",
      url: targetUrl,
      snippet: `Structured summary extracted from ${hostname}.`,
      score: 0.88
    },
    {
      title: "Key entities",
      url: `${targetUrl}#entities`,
      snippet: `Main entities and concepts identified on ${hostname}.`,
      score: 0.84
    },
    {
      title: "Actionable insights",
      url: `${targetUrl}#insights`,
      snippet: `Actionable takeaways and implementation notes from ${hostname}.`,
      score: 0.81
    }
  ];
}

export class ScrapeAdapter implements ProviderAdapter {
  constructor(public id: string) {}

  async isHealthy(): Promise<boolean> {
    return true;
  }

  async execute(targetUrl: string, _context?: PaidQueryContext): Promise<ProviderResultItem[]> {
    await assertSafeScrapeTarget(targetUrl);
    const groqItems = await fetchGroqItems("scrape", targetUrl);
    if (!groqItems || groqItems.length === 0) {
      throw new Error("No items returned from scrape provider");
    }
    return groqItems;
  }

  getFallback(targetUrl: string): ProviderResultItem[] {
    assertSafeTarget(targetUrl);
    return buildScrapeItems(targetUrl);
  }
}
