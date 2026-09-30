import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

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
  API_BASE_URL: z.string().url().default("http://localhost:3001"),
  STELLAR_NETWORK: z.string().default("stellar:testnet"),
  STELLAR_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  X402_FACILITATOR_URL: z.string().url().default("https://channels.openzeppelin.com/x402/testnet"),
  X402_FACILITATOR_API_KEY: z.string().optional(),
  X402_PAY_TO_ADDRESS: z.string().optional(),
  /** Expected settlement asset; 402 challenges naming a different asset are refused. */
  X402_ASSET: z.string().default("USDC"),
  /** Maximum price per query the CLI is willing to sign, in USD. */
  X402_MAX_PRICE_USD: z.coerce.number().positive().default(0.05),
  DEMO_CLIENT_SECRET_KEY: z.string().optional(),
  DEMO_CLIENT_PUBLIC_KEY: z.string().optional(),
  DEMO_MODE: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

export const config = parsed.data;
