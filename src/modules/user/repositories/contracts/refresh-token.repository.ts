import { RefreshToken } from '@modules/user/entities/RefreshToken';

export abstract class RefreshTokensRepository {
  abstract findUniqueByUserIdAndToken(
    userId: string,
    token: string,
  ): Promise<RefreshToken | null>;

  abstract replaceByToken(
    userId: string,
    currentToken: string,
    nextRefreshToken: RefreshToken,
  ): Promise<boolean>;

  abstract replaceAllByUserId(
    userId: string,
    nextRefreshToken: RefreshToken,
  ): Promise<void>;

  abstract delete(id: string): Promise<void>;
}
