type HeaderRecord = Record<string, string | undefined>;

const SENSITIVE_HEADER_PATTERNS = [/^payment$/i, /^payment-response$/i, /^authorization$/i];

export function redactSensitiveHeaders(headers: HeaderRecord): HeaderRecord {
  const redacted: HeaderRecord = {};

  for (const [key, value] of Object.entries(headers)) {
    const isSensitive = SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(key));

    if (isSensitive) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

export function isSensitiveHeader(headerName: string): boolean {
  return SENSITIVE_HEADER_PATTERNS.some((pattern) => pattern.test(headerName));
}
