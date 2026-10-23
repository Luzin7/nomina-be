import { RefreshToken } from '@modules/user/entities/RefreshToken';

export abstract class RefreshTokensRepository {
  abstract create(refreshToken: RefreshToken): Promise<void>;

  abstract findUniqueByTokenHash(
    tokenHash: string,
  ): Promise<RefreshToken | null>;

  abstract rotate(current: RefreshToken, next: RefreshToken): Promise<boolean>;

  abstract revokeBySessionId(sessionId: string): Promise<void>;

  abstract delete(id: string): Promise<void>;
}
