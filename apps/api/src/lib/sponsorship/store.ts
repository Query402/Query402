import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sponsorship_budgets (
  scope TEXT NOT NULL,
  wallet TEXT,
  spent_usd REAL NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  PRIMARY KEY (scope, wallet, window_start)
);

CREATE TABLE IF NOT EXISTS sponsorship_nonces (
  nonce TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_proofs (
  transaction_hash TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  request_hash TEXT NOT NULL DEFAULT ''
);
`;

let db: Database.Database | null = null;
let initError: Error | null = null;

export function getSponsorshipDb(): Database.Database {
  if (db) {
    return db;
  }

  if (initError) {
    throw initError;
  }

  try {
    const directory = path.dirname(config.sponsorshipDbPath);
    fs.mkdirSync(directory, { recursive: true });

    const database = new Database(config.sponsorshipDbPath);
    database.pragma("journal_mode = WAL");
    database.exec(SCHEMA);
    db = database;
    return database;
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error));
    throw initError;
  }
}

export function isSponsorshipStorageAvailable(): boolean {
  try {
    getSponsorshipDb();
    return true;
  } catch {
    return false;
  }
}

export function runInTransaction<T>(fn: (database: Database.Database) => T): T {
  const database = getSponsorshipDb();
  const transaction = database.transaction(fn);
  return transaction(database);
}

export function closeSponsorshipDb(): void {
  if (db) {
    db.close();
    db = null;
  }
  initError = null;
}
