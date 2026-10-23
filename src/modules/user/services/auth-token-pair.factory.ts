import { UserRole } from '@constants/enums';
import { env } from '@infra/env';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { Injectable } from '@nestjs/common';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { Either, left, right } from '@shared/core/errors/Either';

export interface AccessTokenClaimsInput {
  userId: string;
  userName: string;
  workspaceId: string;
  workspaceName: string;
  role: UserRole;
}

export interface BuildAuthTokenPairInput extends AccessTokenClaimsInput {
  sessionId: string;
  expiresAt: Date;
  rawRefreshToken: string;
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

  signAccessToken(claims: AccessTokenClaimsInput): Promise<string> {
    return this.encrypter.encrypt(
      {
        sub: claims.userId,
        name: claims.userName,
        workspaceId: claims.workspaceId,
        workspaceName: claims.workspaceName,
        role: claims.role,
      },
      { expiresIn: env.JWT_USER_ACCESS_EXPIRES_IN },
    );
  }

  async build(
    input: BuildAuthTokenPairInput,
  ): Promise<Either<Error, AuthTokenPair>> {
    const refreshTokenOrError = RefreshToken.create({
      tokenHash: this.tokenHasher.hash(input.rawRefreshToken),
      sessionId: input.sessionId,
      expiresAt: input.expiresAt,
    });
    if (refreshTokenOrError.isLeft()) return left(refreshTokenOrError.value);

    return right({
      accessToken: await this.signAccessToken(input),
      rawRefreshToken: input.rawRefreshToken,
      refreshToken: refreshTokenOrError.value,
    });
  }
}
