import { z } from "zod";
import type { ProviderResultItem, QueryMode } from "@query402/shared";
import { config } from "./config.js";

export const GROQ_REQUEST_TIMEOUT_MS = 8_000;
export const GROQ_MAX_RESPONSE_BYTES = 256 * 1024;

type GroqRequestOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Groq response exceeded size limit");
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new Error("Groq response exceeded size limit");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

const groqItemsSchema = z.array(
  z.object({
    title: z.string().min(1),
    url: z.string().url(),
    snippet: z.string().min(1),
    score: z.number().min(0).max(1)
  })
);

function parseItemsFromContent(content: string) {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error("Groq response was not valid JSON");
  }

  const direct = groqItemsSchema.safeParse(parsedJson);
  if (direct.success) {
    return direct.data;
  }

  const wrapped = z.object({ items: groqItemsSchema }).safeParse(parsedJson);
  if (wrapped.success) {
    return wrapped.data.items;
  }

  throw new Error("Groq response JSON shape is invalid");
}

function buildPrompt(mode: QueryMode, query: string): string {
  if (mode === "scrape") {
    return [
      `Target URL: ${query}`,
      "Extract key information from this page and return 3 JSON items only.",
      "Use this shape for each item: title, url, snippet, score.",
      "Prefer: page summary, key entities/topics, practical insights.",
      "URLs should be the target URL or same-site anchors when relevant.",
      "No markdown, no explanations, JSON only."
    ].join("\n");
  }

  const modeLabel = mode === "news" ? "news" : "search";
  return [
    `User query: ${query}`,
    `Return 3 high quality ${modeLabel} results as JSON only.`,
    "Each item must include: title, url, snippet, score.",
    "Use valid https URLs and concise snippets.",
    "No markdown, no explanations, JSON only."
  ].join("\n");
}

export async function fetchGroqItems(
  mode: QueryMode,
  query: string,
  options: GroqRequestOptions = {}
): Promise<ProviderResultItem[] | null> {
  if (!config.GROQ_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? GROQ_REQUEST_TIMEOUT_MS
  );
  let response: Response;

  try {
    response = await (options.fetch ?? fetch)("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: config.groqModel,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are a retrieval assistant. Always return strict JSON only. Keep claims cautious and avoid fabricated certainty."
          },
          {
            role: "user",
            content: buildPrompt(mode, query)
          }
        ]
      })
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error("Groq request timed out");
    }
    throw new Error("Groq request failed");
  } finally {
    clearTimeout(timeout);
  }

  const payload = await readBoundedText(
    response,
    options.maxResponseBytes ?? GROQ_MAX_RESPONSE_BYTES
  );

  if (!response.ok) {
    throw new Error(`Groq request failed (status ${response.status})`);
  }

  let data: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    data = JSON.parse(payload) as typeof data;
  } catch {
    throw new Error("Groq response was not valid JSON");
  }
  const content = data.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Groq response did not include text content");
  }

  return parseItemsFromContent(content).slice(0, 3);
}
