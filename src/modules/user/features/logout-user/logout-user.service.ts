import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { Injectable } from '@nestjs/common';
import { refreshTokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Decoder } from '@providers/cryptography/contracts/Decoder';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = string | undefined;
type Response = null;

@Injectable()
export class LogoutUserService implements Service<Request, void, Response> {
  constructor(
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly decrypter: Decoder,
    private readonly tokenHasher: TokenHasher,
  ) {}

  async execute(refreshToken: Request): Promise<Either<void, Response>> {
    if (!refreshToken) return right(null);

    const userId = await this.resolveUserId(refreshToken);

    if (!userId) return right(null);

    const savedToken =
      await this.refreshTokensRepository.findUniqueByUserIdAndToken(
        userId,
        this.tokenHasher.hash(refreshToken),
      );

    if (!savedToken) return right(null);

    await this.refreshTokensRepository.delete(savedToken.id);

    return right(null);
  }

  private async resolveUserId(refreshToken: string): Promise<string | null> {
    const { isValid, payload } = await this.decrypter.decrypt(refreshToken);

    if (!isValid || !payload) return null;

    const parsedPayload = refreshTokenPayloadSchema.safeParse(payload);

    return parsedPayload.success ? parsedPayload.data.sub : null;
  }
}
