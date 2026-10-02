import { env } from '@infra/env';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import {
  InvalidRefreshTokenError,
  UserNotFoundError,
} from '@modules/user/errors';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Injectable } from '@nestjs/common';
import { refreshTokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Decoder } from '@providers/cryptography/contracts/Decoder';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { SessionExpiredError } from '@shared/errors/SessionExpiredError';

type Response = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class RefreshTokenService implements Service<
  string | undefined,
  Error,
  Response
> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly decrypter: Decoder,
    private readonly encrypter: Encrypter,
    private readonly dateProvider: DateProvider,
    private readonly workspaceUserRepository: WorkspaceUserRepository,
    private readonly tokenHasher: TokenHasher,
  ) {}

  async execute(
    refreshToken: string | undefined,
  ): Promise<Either<Error, Response>> {
    if (!refreshToken) return left(new SessionExpiredError());

    const userId = await this.resolveUserId(refreshToken);

    if (!userId) return left(new SessionExpiredError());

    const user = await this.userRepository.findUniqueById(userId);

    if (!user) return left(new UserNotFoundError());

    const defaultWorkspaceUser =
      await this.workspaceUserRepository.findDefaultWorkspaceByUserId(user.id);

    if (!defaultWorkspaceUser) return left(new SessionExpiredError());

    const [accessToken, rawRefreshToken] = await Promise.all([
      this.encrypter.encrypt(
        {
          sub: user.id,
          name: user.name,
          workspaceId: defaultWorkspaceUser.user.workspaceId,
          workspaceName: defaultWorkspaceUser.workspaceName,
          role: defaultWorkspaceUser.user.role,
        },
        { expiresIn: env.JWT_USER_ACCESS_EXPIRES_IN },
      ),
      this.encrypter.encrypt(
        { sub: user.id.toString() },
        { expiresIn: env.JWT_USER_REFRESH_EXPIRES_IN },
      ),
    ]);

    const createdRefreshToken = RefreshToken.create({
      userId: user.id,
      token: this.tokenHasher.hash(rawRefreshToken),
      expiresIn: this.dateProvider.addDaysInCurrentDate(
        env.USER_REFRESH_EXPIRES_IN,
      ),
    });

    if (createdRefreshToken.isLeft()) {
      return left(new InvalidRefreshTokenError());
    }

    const rotated = await this.refreshTokensRepository.replaceByToken(
      user.id,
      this.tokenHasher.hash(refreshToken),
      createdRefreshToken.value,
    );

    if (!rotated) return left(new SessionExpiredError());

    return right({
      accessToken,
      refreshToken: rawRefreshToken,
    });
  }

  private async resolveUserId(refreshToken: string): Promise<string | null> {
    const { isValid, payload } = await this.decrypter.decrypt(refreshToken);

    if (!isValid || !payload) return null;

    const parsedPayload = refreshTokenPayloadSchema.safeParse(payload);

    return parsedPayload.success ? parsedPayload.data.sub : null;
  }
}
