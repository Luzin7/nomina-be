import { env } from '@infra/env';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Injectable } from '@nestjs/common';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { HashComparer } from '@providers/cryptography/contracts/HashComparer';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

import { WrongCredentialsError } from '@modules/user/errors';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { LoginUserRequest } from './login-user.dto';

type Request = LoginUserRequest;
type Response = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class LoginUserService implements Service<Request, Error, Response> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly workspaceUserRepository: WorkspaceUserRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly hashComparer: HashComparer,
    private readonly encrypter: Encrypter,
    private readonly dateProvider: DateProvider,
    private readonly tokenHasher: TokenHasher,
  ) {}

  async execute({
    email,
    password,
  }: Request): Promise<Either<Error, Response>> {
    const user = await this.userRepository.findUniqueByEmail(email);
    if (!user) {
      return left(new WrongCredentialsError());
    }

    const isPasswordValid = await this.hashComparer.compare(
      password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      return left(new WrongCredentialsError());
    }

    const expiresInDays = Number(env.USER_REFRESH_EXPIRES_IN);

    const [defaultWorkspaceUser, rawRefreshToken] = await Promise.all([
      this.workspaceUserRepository.findDefaultWorkspaceByUserId(user.id),
      this.encrypter.encrypt(
        { sub: user.id },
        { expiresIn: env.JWT_USER_REFRESH_EXPIRES_IN },
      ),
    ]);

    if (!defaultWorkspaceUser) {
      return left(new UnauthorizedError());
    }

    const [accessToken, expirationDate] = await Promise.all([
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
      Promise.resolve(this.dateProvider.addDaysInCurrentDate(expiresInDays)),
    ]);

    const refreshTokenOrError = RefreshToken.create({
      userId: user.id,
      token: this.tokenHasher.hash(rawRefreshToken),
      expiresIn: expirationDate,
    });

    if (refreshTokenOrError.isLeft()) {
      return left(refreshTokenOrError.value);
    }

    await this.refreshTokensRepository.replaceAllByUserId(
      user.id,
      refreshTokenOrError.value,
    );

    return right({
      accessToken,
      refreshToken: rawRefreshToken,
    });
  }
}
