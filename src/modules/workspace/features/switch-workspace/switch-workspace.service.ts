import { env } from '@infra/env';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { UserNotFoundError } from '@modules/user/errors';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import {
  WorkspaceNotFoundError,
  WorkspaceUserNotFoundError,
} from '@modules/workspace/errors';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Encrypter } from '@providers/cryptography/contracts/Encrypter';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { SwitchWorkspaceRequest } from './switch-workspace.dto';

type Request = SwitchWorkspaceRequest & Pick<TokenPayloadSchema, 'sub'>;
type Response = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class SwitchWorkspaceService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly workspaceUserRepository: WorkspaceUserRepository,
    private readonly userRepository: UserRepository,
    private readonly encrypter: Encrypter,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly dateProvider: DateProvider,
    private readonly tokenHasher: TokenHasher,
  ) {}

  async execute({
    workspaceId,
    sub,
  }: Request): Promise<Either<Error, Response>> {
    const workspace = await this.workspaceRepository.findById(workspaceId);
    if (!workspace) return left(new WorkspaceNotFoundError());

    const workspaceUser =
      await this.workspaceUserRepository.findUserByWorkspaceAndUserId(
        workspaceId,
        sub,
      );
    if (!workspaceUser) return left(new WorkspaceUserNotFoundError());

    const user = await this.userRepository.findUniqueById(sub);
    if (!user) return left(new UserNotFoundError());

    const accessToken = await this.encrypter.encrypt(
      {
        sub: user.id,
        name: user.name,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        role: workspaceUser.role,
      },
      { expiresIn: env.JWT_USER_ACCESS_EXPIRES_IN },
    );

    const rawRefreshToken = await this.encrypter.encrypt(
      { sub: user.id },
      { expiresIn: env.JWT_USER_REFRESH_EXPIRES_IN },
    );

    const expiresInDays = Number(env.USER_REFRESH_EXPIRES_IN);
    const expirationDate = this.dateProvider.add(
      this.dateProvider.now(),
      expiresInDays,
      'day',
      'UTC',
    );

    const refreshTokenOrError = RefreshToken.create({
      userId: user.id,
      token: this.tokenHasher.hash(rawRefreshToken),
      expiresIn: expirationDate,
    });

    if (refreshTokenOrError.isLeft()) {
      return left(refreshTokenOrError.value);
    }

    await this.refreshTokensRepository.replaceAllByUserId(
      sub,
      refreshTokenOrError.value,
    );

    return right({
      accessToken,
      refreshToken: rawRefreshToken,
    });
  }
}
