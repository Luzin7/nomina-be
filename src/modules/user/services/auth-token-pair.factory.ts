import { UserRole } from '@constants/enums';
import { env } from '@infra/env';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { Injectable } from '@nestjs/common';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { Either, left, right } from '@shared/core/errors/Either';

export interface BuildAuthTokenPairInput {
  userId: string;
  userName: string;
  workspaceId: string;
  workspaceName: string;
  role: UserRole;
  sessionId: string;
  expiresAt: Date;
}

export interface AuthTokenPair {
  accessToken: string;
  rawRefreshToken: string;
  refreshToken: RefreshToken;
}

@Injectable()
export class AuthTokenPairFactory {
  constructor(
    private readonly encrypter: Encrypter,
    private readonly tokenHasher: TokenHasher,
  ) {}

  async build(
    input: BuildAuthTokenPairInput,
  ): Promise<Either<Error, AuthTokenPair>> {
    const [accessToken, rawRefreshToken] = await Promise.all([
      this.encrypter.encrypt(
        {
          sub: input.userId,
          name: input.userName,
          workspaceId: input.workspaceId,
          workspaceName: input.workspaceName,
          role: input.role,
        },
        { expiresIn: env.JWT_USER_ACCESS_EXPIRES_IN },
      ),
      this.encrypter.encrypt(
        { sub: input.userId },
        { expiresIn: env.JWT_USER_REFRESH_EXPIRES_IN },
      ),
    ]);

    const refreshTokenOrError = RefreshToken.create({
      tokenHash: this.tokenHasher.hash(rawRefreshToken),
      sessionId: input.sessionId,
      expiresAt: input.expiresAt,
    });
    if (refreshTokenOrError.isLeft()) return left(refreshTokenOrError.value);

    return right({
      accessToken,
      rawRefreshToken,
      refreshToken: refreshTokenOrError.value,
    });
  }
}
