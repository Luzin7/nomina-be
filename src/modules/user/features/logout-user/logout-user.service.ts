import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { Injectable } from '@nestjs/common';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = string | undefined;
type Response = null;

@Injectable()
export class LogoutUserService implements Service<Request, void, Response> {
  constructor(
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly authSessionsRepository: AuthSessionsRepository,
    private readonly tokenHasher: TokenHasher,
  ) {}

  async execute(refreshToken: Request): Promise<Either<void, Response>> {
    if (!refreshToken) return right(null);

    const savedToken = await this.refreshTokensRepository.findUniqueByTokenHash(
      this.tokenHasher.hash(refreshToken),
    );

    if (!savedToken) return right(null);

    await this.authSessionsRepository.revoke(savedToken.sessionId);

    return right(null);
  }
}
