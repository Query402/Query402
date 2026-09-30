export interface IdempotencyConfig {
  provider: string;
  query: string;
  paymentReference: string;
}

export function validateConfig(config: IdempotencyConfig): boolean {
  return (
    Boolean(config.provider) &&
    Boolean(config.query) &&
    Boolean(config.paymentReference)
  );
}