import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { credentialFreeHttpUrlSchema } from "@query402/shared";
import { resolveApiDataPath } from "./storage/paths.js";

/** Minimum byte length for configured production signing secrets (e.g. SPONSORSHIP_SIGNING_SECRET: 32 bytes / 256 bits). */
export const MIN_PRODUCTION_SIGNING_SECRET_BYTES = 32;

/** Minimum byte length for configured production API secrets (e.g. X402_FACILITATOR_API_KEY: 16 bytes). */
export const MIN_PRODUCTION_API_KEY_BYTES = 16;

const PLACEHOLDER_PATTERNS = [
  /placeholder/i,
  /change[-_]?me/i,
  /replace[-_]?me/i,
  /your[-_]?(secret|api[-_]?key|key|token)/i,
  /^example/i,
  /^sample/i,
  /^test[-_]?/i,
  /^dev[-_]?/i,
  /^todo/i,
  /^default/i,
  /^secret$/i,
  /^api[-_]?key$/i,
  /^(.)\1+$/, // all repeated character e.g. "aaaaa..."
  /^123456/i,
  /^abcdef/i
];

/**
 * Validates a single CORS origin string at startup.
 *
 * Rules:
 * - Accept only canonical HTTP(S) origins with scheme, host, and optional port.
 * - Reject credentials, paths, queries, fragments, null, and wildcards.
 * - Startup errors never echo embedded credentials.
 */
export function validateCorsOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin.trim();
  if (!trimmed) {
    throw new Error("Invalid CORS origin: empty origin is not allowed");
  }

  if (trimmed.toLowerCase() === "null" || trimmed === "*" || trimmed.includes("*")) {
    throw new Error("Invalid CORS origin: wildcard or null origins are not allowed");
  }

  // Pre-check for credentials or @ before URL parsing to ensure credentials are never echoed in errors
  if (trimmed.includes("@")) {
    throw new Error("Invalid CORS origin: credentials are not allowed");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid CORS origin: must be a valid HTTP or HTTPS origin");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid CORS origin: scheme must be http or https");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Invalid CORS origin: credentials are not allowed");
  }

  if (parsed.search || trimmed.includes("?")) {
    throw new Error("Invalid CORS origin: queries are not allowed");
  }

  if (parsed.hash || trimmed.includes("#")) {
    throw new Error("Invalid CORS origin: fragments are not allowed");
  }

  // Canonical HTTP(S) origin consists of scheme, host, and optional port (no path or trailing slash).
  const canonical = `${parsed.protocol}//${parsed.host}`.toLowerCase();
  if (trimmed.toLowerCase() !== canonical) {
    throw new Error("Invalid CORS origin: paths and trailing slashes are not allowed");
  }

  return canonical;
}

/**
 * Parses and validates comma-separated CORS_ORIGINS operator input.
 */
export function parseAndValidateCorsOrigins(raw?: string): string[] {
  if (!raw || raw.trim() === "") {
    return [];
  }

  const items = raw.split(",").map((s) => s.trim());
  return items.map((item) => validateCorsOrigin(item));
}

/**
 * Validates secret strength in production at startup.
 *
 * Rules:
 * - In production, configured signing/API secrets must meet a documented minimum byte length.
 * - Known placeholder-shaped values are rejected.
 * - Errors name only the variable, never its value.
 */
export function validateProductionSecret(
  varName: string,
  value: string | undefined,
  minBytes: number
): void {
  if (!value || value.trim() === "") {
    return;
  }

  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength < minBytes) {
    throw new Error(
      `${varName} does not meet production strength requirements: must be at least ${minBytes} bytes`
    );
  }

  const trimmed = value.trim();
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(
        `${varName} does not meet production strength requirements: placeholder value rejected`
      );
    }
  }
}

export function validateProductionSecrets(environment: {
  NODE_ENV: string;
  SPONSORSHIP_SIGNING_SECRET?: string;
  X402_FACILITATOR_API_KEY?: string;
  DEMO_CLIENT_SECRET_KEY?: string;
}): void {
  if (environment.NODE_ENV !== "production") {
    return;
  }

  validateProductionSecret(
    "SPONSORSHIP_SIGNING_SECRET",
    environment.SPONSORSHIP_SIGNING_SECRET,
    MIN_PRODUCTION_SIGNING_SECRET_BYTES
  );
  validateProductionSecret(
    "X402_FACILITATOR_API_KEY",
    environment.X402_FACILITATOR_API_KEY,
    MIN_PRODUCTION_API_KEY_BYTES
  );
}

function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
  }

  dotenv.config();
}

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT_API: z.coerce.number().default(3001),
  // 64 KiB. Passed to express.json as a byte limit (inclusive).
  API_JSON_BODY_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(64 * 1024),
  STELLAR_NETWORK: z.string().default("stellar:testnet"),
  STELLAR_RPC_URL: credentialFreeHttpUrlSchema.default("https://soroban-testnet.stellar.org"),
  X402_FACILITATOR_URL: credentialFreeHttpUrlSchema.default(
    "https://channels.openzeppelin.com/x402/testnet"
  ),
  X402_FACILITATOR_API_KEY: z.string().optional(),
  X402_PAY_TO_ADDRESS: z.string().min(10, "X402_PAY_TO_ADDRESS is required").optional(),
  API_BASE_URL: credentialFreeHttpUrlSchema.default("http://localhost:3001"),
  CORS_ORIGINS: z.string().optional(),
  DEMO_CLIENT_SECRET_KEY: z.string().optional(),
  DEMO_CLIENT_PUBLIC_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  NEWS_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  DEMO_MODE: z.string().optional(),
  SPONSORSHIP_ENABLED: z.string().optional(),
  SPONSORSHIP_SIGNING_SECRET: z.string().optional(),
  SPONSORSHIP_GLOBAL_DAILY_BUDGET_USD: z.coerce.number().positive().default(10),
  SPONSORSHIP_PER_WALLET_DAILY_BUDGET_USD: z.coerce.number().positive().default(1),
  SPONSORSHIP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  CHALLENGE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  CHALLENGE_RATE_LIMIT_MAX_CLIENTS: z.coerce.number().int().positive().default(10_000),
  SPONSORSHIP_GRANT_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  SPONSORSHIP_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  SPONSORSHIP_DB_PATH: z.string().min(1).default("data/sponsorship.db"),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  ANALYTICS_DB_PATH: z.string().min(1).default("data/analytics.db"),
  ANALYTICS_STORAGE: z.enum(["sqlite", "memory"]).default("sqlite")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success || !parsed.data) {
  throw new Error(`Invalid environment: ${parsed.error?.message ?? "unknown error"}`);
}

const env = parsed.data;

validateProductionSecrets(env);

export const config = {
  ...env,
  corsOrigins: parseAndValidateCorsOrigins(env.CORS_ORIGINS),
  groqModel: env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
  demoMode: env.DEMO_MODE === "true",
  sponsorshipEnabled: env.SPONSORSHIP_ENABLED === "true",
  sponsorshipDbPath: resolveApiDataPath(env.SPONSORSHIP_DB_PATH),
  analyticsDbPath: resolveApiDataPath(env.ANALYTICS_DB_PATH),
  analyticsStorage: env.ANALYTICS_STORAGE
};

export function getFacilitatorConfigured(): boolean {
  return (
    !!env.X402_FACILITATOR_URL &&
    !!env.X402_FACILITATOR_API_KEY &&
    env.X402_FACILITATOR_API_KEY.length > 0
  );
}

/**
 * A sanitized snapshot of the deployment configuration.
 * Contains only booleans and safe enum values — never secrets, private keys, or auth headers.
 */
export interface ConfigSnapshot {
  network: string;
  demoMode: boolean;
  facilitatorConfigured: boolean;
  facilitatorApiKeyConfigured: boolean;
  payToConfigured: boolean;
  sponsorshipEnabled: boolean;
  sponsorshipSigningSecretConfigured: boolean;
  anyProviderKeyConfigured: boolean;
}

/** Safe to expose in public health/diagnostics responses — no secret values. */
export function getConfigSnapshot(): ConfigSnapshot {
  return {
    network: config.STELLAR_NETWORK,
    demoMode: config.demoMode,
    facilitatorConfigured: Boolean(config.X402_FACILITATOR_URL),
    facilitatorApiKeyConfigured: Boolean(config.X402_FACILITATOR_API_KEY),
    payToConfigured: Boolean(config.X402_PAY_TO_ADDRESS),
    sponsorshipEnabled: config.sponsorshipEnabled,
    sponsorshipSigningSecretConfigured: Boolean(config.SPONSORSHIP_SIGNING_SECRET),
    anyProviderKeyConfigured: Boolean(
      config.BRAVE_API_KEY || config.SERPAPI_API_KEY || config.NEWS_API_KEY || config.GROQ_API_KEY
    )
  };
}

export function requirePayToAddress(): string {
  const addr = env.X402_PAY_TO_ADDRESS;
  if (!addr || addr.length === 0) {
    throw new Error("X402_PAY_TO_ADDRESS is not configured");
  }
  return addr;
}
