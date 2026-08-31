type HeaderRecord = Record<string, string | undefined>;

const SENSITIVE_HEADER_PATTERNS = [
  /^payment$/i,
  /^payment-response$/i,
  /^payment-signature$/i,
  /^x-payment$/i,
  /^x-payment-response$/i,
  /^x-payment-signature$/i,
  /^authorization$/i,
  /^proxy-authorization$/i
];

const SAFE_REQUEST_IDENTIFIER_PATTERNS = [
  /^trace(?:[-_]?id)?$/i,
  /^x[-_]?trace(?:[-_]?id)?$/i,
  /^request(?:[-_]?id)?$/i,
  /^x[-_]?request(?:[-_]?id)?$/i,
  /^payment[-_]?attempt(?:[-_]?id)?$/i,
  /^x[-_]?payment[-_]?attempt(?:[-_]?id)?$/i,
  /^traceid$/i,
  /^requestid$/i,
  /^paymentattemptid$/i,
  /^xpaymentattemptid$/i
];

function normalizeFieldName(fieldName: string): string {
  return fieldName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function isSensitiveHeader(headerName: string): boolean {
  return SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(headerName));
}

export function isSensitiveFieldName(fieldName: string): boolean {
  const normalized = normalizeFieldName(fieldName);

  if (SAFE_REQUEST_IDENTIFIER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const sensitiveTokens = [
    "authorization",
    "proxyauthorization",
    "paymentresponse",
    "paymentsignature",
    "xpayment",
    "xpaymentresponse",
    "xpaymentsignature",
    "signature",
    "proof",
    "token",
    "secret",
    "privatekey",
    "apikey",
    "payment"
  ];

  return sensitiveTokens.some((token) => normalized === token || normalized.includes(token));
}

export function redactSensitiveObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveObject(item)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (nestedValue !== null && typeof nestedValue === "object") {
      redacted[key] = redactSensitiveObject(nestedValue);
      continue;
    }

    if (isSensitiveFieldName(key)) {
      redacted[key] = "[REDACTED]";
      continue;
    }

    redacted[key] = nestedValue;
  }

  return redacted as T;
}

export function redactSensitiveHeaders(headers: HeaderRecord): HeaderRecord {
  const redacted: HeaderRecord = {};

  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = isSensitiveHeader(key) ? "[REDACTED]" : value;
  }

  return redacted;
}
