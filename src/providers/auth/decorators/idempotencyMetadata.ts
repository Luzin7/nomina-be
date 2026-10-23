export const IDEMPOTENCY_KEY = 'idempotency';

export interface IdempotencyOptions {
  ttlSeconds?: number;
}
