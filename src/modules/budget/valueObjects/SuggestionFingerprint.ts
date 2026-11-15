import { createHash } from 'node:crypto';

const FINGERPRINT_LENGTH = 32;

export const fingerprintOf = (payload: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, FINGERPRINT_LENGTH);
