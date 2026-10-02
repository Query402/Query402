import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { PaymentAttempt, UsageEvent } from "@query402/shared";
import { z } from "zod";
import { paymentAttemptToRow, usageEventToRow } from "./serialization.js";
import { closeAnalyticsDb, getAnalyticsDb, runInAnalyticsTransaction } from "./sqlite/store.js";
import { resolveApiDataPath } from "./paths.js";

const usageEventSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(["search", "news", "scrape"]),
  endpoint: z.string().min(1),
  providerId: z.string().min(1),
  queryOrUrl: z.string().min(1),
  priceUsd: z.number(),
  network: z.string().min(1),
  paymentStatus: z
    .enum(["verified", "settled", "failed", "demo-paid", "paid"])
    .transform((value) => (value === "paid" ? "settled" : value)),
  paymentTxHash: z.string().optional(),
  facilitatorUrl: z.string().optional(),
  payerPublicKey: z.string().optional(),
  traceId: z.string().min(1),
  createdAt: z.string().min(1),
  latencyMs: z.number(),
  sponsorshipGrantId: z.string().optional(),
  policyDecision: z.string().optional(),
  paymentSource: z.enum(["sponsored", "wallet", "demo"]).optional(),
  sponsorPublicKey: z.string().optional()
});

const paymentAttemptSchema = z.object({
  id: z.string().min(1),
  endpoint: z.string().min(1),
  providerId: z.string().min(1),
  amountUsd: z.number(),
  network: z.string().min(1),
  payerPublicKey: z.string().optional(),
  payToAddress: z.string().min(1),
  facilitatorUrl: z.string().min(1),
  status: z.enum(["demo-paid", "verified", "settled", "failed"]),
  transactionHash: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().min(1),
  sponsorshipGrantId: z.string().optional(),
  policyDecision: z.string().optional(),
  paymentSource: z.enum(["sponsored", "wallet", "demo"]).optional(),
  sponsorPublicKey: z.string().optional()
});

const legacyDbSchema = z.object({
  usage: z.array(usageEventSchema),
  payments: z.array(paymentAttemptSchema)
});

export type LegacyDbJson = z.infer<typeof legacyDbSchema>;

export type MigrationCollisionKind = "idempotency_key" | "payment_reference";
export type MigrationCollisionScope = "file" | "database";
export type MigrationCollisionTable = "usage_events" | "payment_attempts";

/**
 * Raised when a source record would collide with another record in the same
 * file or with a row that already exists in the target database. The whole
 * import is rolled back when this is thrown.
 *
 * Collision messages identify records by their ids only. Payment headers and
 * payment references (transaction hashes) from the source file are never
 * echoed into messages or logs.
 */
export class JsonMigrationCollisionError extends Error {
  readonly kind: MigrationCollisionKind;
  readonly scope: MigrationCollisionScope;
  readonly table: MigrationCollisionTable;

  constructor(
    kind: MigrationCollisionKind,
    scope: MigrationCollisionScope,
    table: MigrationCollisionTable,
    detail: string
  ) {
    super(detail);
    this.name = "JsonMigrationCollisionError";
    this.kind = kind;
    this.scope = scope;
    this.table = table;
  }
}

export interface JsonMigrationOptions {
  sourcePath: string;
  targetPath: string;
  dryRun?: boolean;
  archiveSource?: boolean;
}

export interface JsonMigrationResult {
  sourcePath: string;
  targetPath: string;
  usageTotal: number;
  usageInserted: number;
  usageSkipped: number;
  paymentsTotal: number;
  paymentsInserted: number;
  paymentsSkipped: number;
  dryRun: boolean;
  archivedPath?: string;
}

const INSERT_USAGE = `
INSERT INTO usage_events (
  id, mode, endpoint, provider_id, query_or_url, price_usd, network,
  payment_status, payment_kind, payment_tx_hash, asset, pay_to_address, amount,
  facilitator_url, payer_public_key, trace_id, created_at, latency_ms,
  sponsorship_grant_id, policy_decision, payment_source, sponsor_public_key
) VALUES (
  @id, @mode, @endpoint, @provider_id, @query_or_url, @price_usd, @network,
  @payment_status, @payment_kind, @payment_tx_hash, @asset, @pay_to_address, @amount,
  @facilitator_url, @payer_public_key, @trace_id, @created_at, @latency_ms,
  @sponsorship_grant_id, @policy_decision, @payment_source, @sponsor_public_key
)
`;

const INSERT_PAYMENT = `
INSERT INTO payment_attempts (
  id, endpoint, provider_id, amount_usd, network, asset, amount, evidence_kind,
  payer_public_key, pay_to_address, facilitator_url, status, transaction_hash,
  facilitator_result, error, created_at, sponsorship_grant_id, policy_decision,
  payment_source, sponsor_public_key
) VALUES (
  @id, @endpoint, @provider_id, @amount_usd, @network, @asset, @amount, @evidence_kind,
  @payer_public_key, @pay_to_address, @facilitator_url, @status, @transaction_hash,
  @facilitator_result, @error, @created_at, @sponsorship_grant_id, @policy_decision,
  @payment_source, @sponsor_public_key
)
`;

export function discoverLegacyDbJsonPaths(extraCandidates: string[] = []): string[] {
  const candidates = [
    ...extraCandidates,
    resolveApiDataPath("data/db.json"),
    resolveApiDataPath("apps/api/data/db.json"),
    path.resolve(process.cwd(), "apps/api/data/db.json"),
    path.resolve(process.cwd(), "data/db.json")
  ];

  const seen = new Set<string>();
  const existing: string[] = [];

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized) || !fs.existsSync(normalized)) {
      continue;
    }

    seen.add(normalized);
    existing.push(normalized);
  }

  return existing;
}

export function parseLegacyDbJson(raw: string): LegacyDbJson {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    // Do not include the parser message: it can quote the source file.
    throw new Error("Invalid legacy db.json shape: source file is not valid JSON.");
  }

  const parsed = legacyDbSchema.safeParse(parsedJson);
  if (!parsed.success) {
    // Report only field paths and issue codes. Raw zod messages can echo
    // values straight from the source file, including payment headers.
    const details = parsed.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`)
      .join("; ");
    throw new Error(`Invalid legacy db.json shape: ${details}`);
  }

  return parsed.data;
}

export function readLegacyDbJson(sourcePath: string): LegacyDbJson {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Legacy db.json not found: ${sourcePath}`);
  }

  const raw = fs.readFileSync(sourcePath, "utf-8");
  return parseLegacyDbJson(raw);
}

function findDuplicateId(values: string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }

  return null;
}

function findDuplicateReference(
  records: { id: string; reference?: string }[]
): { id: string; matchingId: string } | null {
  const firstIdByReference = new Map<string, string>();
  for (const record of records) {
    if (!record.reference) {
      continue;
    }

    const matchingId = firstIdByReference.get(record.reference);
    if (matchingId) {
      return { id: record.id, matchingId };
    }

    firstIdByReference.set(record.reference, record.id);
  }

  return null;
}

const MAX_SQL_PARAMETERS = 400;

function selectExistingValues(
  database: Database.Database,
  table: MigrationCollisionTable,
  column: "id" | "payment_tx_hash" | "transaction_hash",
  values: string[]
): Set<string> {
  const existing = new Set<string>();

  for (let index = 0; index < values.length; index += MAX_SQL_PARAMETERS) {
    const chunk = values.slice(index, index + MAX_SQL_PARAMETERS);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = database
      .prepare(`SELECT ${column} AS value FROM ${table} WHERE ${column} IN (${placeholders})`)
      .all(...chunk) as { value: string }[];

    for (const row of rows) {
      existing.add(row.value);
    }
  }

  return existing;
}

/**
 * Rejects a source file where two records share an idempotency key (record id)
 * or a payment reference (transaction hash). Runs before the target database
 * is opened, so a rejected file never writes anything.
 */
export function assertNoCollisionsInFile(legacy: LegacyDbJson): void {
  const duplicateUsageId = findDuplicateId(legacy.usage.map((event) => event.id));
  if (duplicateUsageId) {
    throw new JsonMigrationCollisionError(
      "idempotency_key",
      "file",
      "usage_events",
      `duplicate idempotency key "${duplicateUsageId}" in source file (usage_events)`
    );
  }

  const duplicatePaymentId = findDuplicateId(legacy.payments.map((payment) => payment.id));
  if (duplicatePaymentId) {
    throw new JsonMigrationCollisionError(
      "idempotency_key",
      "file",
      "payment_attempts",
      `duplicate idempotency key "${duplicatePaymentId}" in source file (payment_attempts)`
    );
  }

  const duplicateUsageReference = findDuplicateReference(
    legacy.usage.map((event) => ({ id: event.id, reference: event.paymentTxHash }))
  );
  if (duplicateUsageReference) {
    throw new JsonMigrationCollisionError(
      "payment_reference",
      "file",
      "usage_events",
      `duplicate payment reference in source file: usage "${duplicateUsageReference.id}" matches usage "${duplicateUsageReference.matchingId}" (usage_events)`
    );
  }

  const duplicatePaymentReference = findDuplicateReference(
    legacy.payments.map((payment) => ({ id: payment.id, reference: payment.transactionHash }))
  );
  if (duplicatePaymentReference) {
    throw new JsonMigrationCollisionError(
      "payment_reference",
      "file",
      "payment_attempts",
      `duplicate payment reference in source file: payment "${duplicatePaymentReference.id}" matches payment "${duplicatePaymentReference.matchingId}" (payment_attempts)`
    );
  }
}

/**
 * Rejects source records that collide with rows already present in the target
 * database. Runs inside the import transaction so a collision rolls back the
 * whole import and leaves the previous database unchanged.
 */
export function assertNoCollisionsWithDatabase(
  database: Database.Database,
  legacy: LegacyDbJson
): void {
  const existingUsageIds = selectExistingValues(
    database,
    "usage_events",
    "id",
    legacy.usage.map((event) => event.id)
  );
  const usageKeyCollision = legacy.usage.find((event) => existingUsageIds.has(event.id));
  if (usageKeyCollision) {
    throw new JsonMigrationCollisionError(
      "idempotency_key",
      "database",
      "usage_events",
      `idempotency key "${usageKeyCollision.id}" from source file already exists in target database (usage_events)`
    );
  }

  const existingPaymentIds = selectExistingValues(
    database,
    "payment_attempts",
    "id",
    legacy.payments.map((payment) => payment.id)
  );
  const paymentKeyCollision = legacy.payments.find((payment) => existingPaymentIds.has(payment.id));
  if (paymentKeyCollision) {
    throw new JsonMigrationCollisionError(
      "idempotency_key",
      "database",
      "payment_attempts",
      `idempotency key "${paymentKeyCollision.id}" from source file already exists in target database (payment_attempts)`
    );
  }

  const existingUsageReferences = selectExistingValues(
    database,
    "usage_events",
    "payment_tx_hash",
    legacy.usage.flatMap((event) => (event.paymentTxHash ? [event.paymentTxHash] : []))
  );
  const usageReferenceCollision = legacy.usage.find((event) =>
    Boolean(event.paymentTxHash && existingUsageReferences.has(event.paymentTxHash))
  );
  if (usageReferenceCollision) {
    throw new JsonMigrationCollisionError(
      "payment_reference",
      "database",
      "usage_events",
      `payment reference for usage "${usageReferenceCollision.id}" from source file already exists in target database (usage_events)`
    );
  }

  const existingPaymentReferences = selectExistingValues(
    database,
    "payment_attempts",
    "transaction_hash",
    legacy.payments.flatMap((payment) => (payment.transactionHash ? [payment.transactionHash] : []))
  );
  const paymentReferenceCollision = legacy.payments.find((payment) =>
    Boolean(payment.transactionHash && existingPaymentReferences.has(payment.transactionHash))
  );
  if (paymentReferenceCollision) {
    throw new JsonMigrationCollisionError(
      "payment_reference",
      "database",
      "payment_attempts",
      `payment reference for payment "${paymentReferenceCollision.id}" from source file already exists in target database (payment_attempts)`
    );
  }
}

function insertRecords(
  database: Database.Database,
  usage: UsageEvent[],
  payments: PaymentAttempt[]
): Pick<
  JsonMigrationResult,
  "usageInserted" | "usageSkipped" | "paymentsInserted" | "paymentsSkipped"
> {
  const insertUsage = database.prepare(INSERT_USAGE);
  const insertPayment = database.prepare(INSERT_PAYMENT);

  let usageInserted = 0;
  let paymentsInserted = 0;

  for (const event of usage) {
    const result = insertUsage.run(usageEventToRow(event));
    if (result.changes === 1) {
      usageInserted += 1;
    }
  }

  for (const payment of payments) {
    const result = insertPayment.run(paymentAttemptToRow(payment));
    if (result.changes === 1) {
      paymentsInserted += 1;
    }
  }

  return {
    usageInserted,
    usageSkipped: usage.length - usageInserted,
    paymentsInserted,
    paymentsSkipped: payments.length - paymentsInserted
  };
}

export function migrateLegacyJsonToSqlite(options: JsonMigrationOptions): JsonMigrationResult {
  const legacy = readLegacyDbJson(options.sourcePath);

  // Reject duplicate idempotency keys and payment references inside the source
  // file before the target database is opened.
  assertNoCollisionsInFile(legacy);

  if (options.dryRun) {
    return {
      sourcePath: options.sourcePath,
      targetPath: options.targetPath,
      usageTotal: legacy.usage.length,
      usageInserted: legacy.usage.length,
      usageSkipped: 0,
      paymentsTotal: legacy.payments.length,
      paymentsInserted: legacy.payments.length,
      paymentsSkipped: 0,
      dryRun: true
    };
  }

  try {
    const counts = runInAnalyticsTransaction(options.targetPath, (database) => {
      // Reject rows that collide with records already in the target database.
      // Throwing here rolls the whole import back, so the previous database
      // is left unchanged.
      assertNoCollisionsWithDatabase(database, legacy);
      return insertRecords(database, legacy.usage, legacy.payments);
    });

    let archivedPath: string | undefined;
    if (options.archiveSource) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      archivedPath = `${options.sourcePath}.migrated.${timestamp}`;
      fs.renameSync(options.sourcePath, archivedPath);
    }

    return {
      sourcePath: options.sourcePath,
      targetPath: options.targetPath,
      usageTotal: legacy.usage.length,
      paymentsTotal: legacy.payments.length,
      dryRun: false,
      archivedPath,
      ...counts
    };
  } finally {
    closeAnalyticsDb();
  }
}

export function assertTargetDbIsEmpty(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const database = getAnalyticsDb(targetPath);
  const usageCount = (
    database.prepare(`SELECT COUNT(*) AS count FROM usage_events`).get() as { count: number }
  ).count;
  const paymentCount = (
    database.prepare(`SELECT COUNT(*) AS count FROM payment_attempts`).get() as { count: number }
  ).count;

  closeAnalyticsDb();

  if (usageCount > 0 || paymentCount > 0) {
    throw new Error(
      `Target analytics database is not empty (${usageCount} usage, ${paymentCount} payments). ` +
        "Use --force to merge records or choose a different ANALYTICS_DB_PATH."
    );
  }
}

export function formatMigrationResult(result: JsonMigrationResult): string {
  const lines = [
    result.dryRun ? "Dry run — no changes written." : "Migration complete.",
    `Source: ${result.sourcePath}`,
    `Target: ${result.targetPath}`,
    `Usage: ${result.usageInserted}/${result.usageTotal} inserted (${result.usageSkipped} skipped)`,
    `Payments: ${result.paymentsInserted}/${result.paymentsTotal} inserted (${result.paymentsSkipped} skipped)`
  ];

  if (result.archivedPath) {
    lines.push(`Archived source: ${result.archivedPath}`);
  }

  return lines.join("\n");
}
