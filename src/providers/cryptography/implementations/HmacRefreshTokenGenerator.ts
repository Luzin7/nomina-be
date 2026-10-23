import { REFRESH_TOKEN_SUCCESSOR_KEY_INFO } from '@constants/auth';
import { normalizePemNewlines } from '@utils/normalizePemNewlines';
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { EmptyRefreshTokenKeyError } from '../errors/EmptyRefreshTokenKeyError';
import { RefreshTokenGenerator } from '../contracts/RefreshTokenGenerator';

const TOKEN_BYTES = 32;
const SUCCESSOR_KEY_BYTES = 32;

export class HmacRefreshTokenGenerator implements RefreshTokenGenerator {
  private readonly successorKey: Buffer;

  constructor(keyMaterial: string) {
    if (!keyMaterial.trim()) throw new EmptyRefreshTokenKeyError();

    this.successorKey = Buffer.from(
      hkdfSync(
        'sha256',
        normalizePemNewlines(keyMaterial),
        '',
        REFRESH_TOKEN_SUCCESSOR_KEY_INFO,
        SUCCESSOR_KEY_BYTES,
      ),
    );
  }

  generate(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
  }

  successorOf(rawToken: string): string {
    return createHmac('sha256', this.successorKey)
      .update(rawToken)
      .digest('base64url');
  }
}
