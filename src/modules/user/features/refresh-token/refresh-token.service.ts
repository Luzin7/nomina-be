import { env } from '@infra/env';
import { AuthSession } from '@modules/user/entities/AuthSession';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { User } from '@modules/user/entities/User';
import { UserNotFoundError } from '@modules/user/errors';
import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { AuthTokenPairFactory } from '@modules/user/services/auth-token-pair.factory';
import { IssuedAuthSession } from '@modules/user/services/issue-auth-session.service';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Injectable } from '@nestjs/common';
import { TokenHasher } from '@providers/cryptography/contracts/TokenHasher';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { SessionExpiredError } from '@shared/errors/SessionExpiredError';

type Response = IssuedAuthSession;

type StoredSession = {
  storedToken: RefreshToken;
  session: AuthSession;
};

type SessionContext = {
  user: User;
  workspaceUser: { user: WorkspaceUser; workspaceName: string };
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
    private readonly authSessionsRepository: AuthSessionsRepository,
    private readonly workspaceUserRepository: WorkspaceUserRepository,
    private readonly authTokenPairFactory: AuthTokenPairFactory,
    private readonly dateProvider: DateProvider,
    private readonly tokenHasher: TokenHasher,
  ) {}

  async execute(
    refreshToken: string | undefined,
  ): Promise<Either<Error, Response>> {
    if (!refreshToken) return left(new SessionExpiredError());

    const storedOrError = await this.loadStoredSession(refreshToken);
    if (storedOrError.isLeft()) return left(storedOrError.value);

    const { storedToken, session } = storedOrError.value;
    if (storedToken.isReused()) return this.revokeFamily(session);

    const contextOrError = await this.resolveContext(storedToken, session);
    if (contextOrError.isLeft()) return left(contextOrError.value);

    return this.rotate(storedToken, session, contextOrError.value);
  }

  private async loadStoredSession(
    refreshToken: string,
  ): Promise<Either<Error, StoredSession>> {
    const storedToken =
      await this.refreshTokensRepository.findUniqueByTokenHash(
        this.tokenHasher.hash(refreshToken),
      );
    if (!storedToken) return left(new SessionExpiredError());

    const session = await this.authSessionsRepository.findUniqueById(
      storedToken.sessionId,
    );
    if (!session) return left(new SessionExpiredError());

    return right({ storedToken, session });
  }

  private async resolveContext(
    storedToken: RefreshToken,
    session: AuthSession,
  ): Promise<Either<Error, SessionContext>> {
    if (!storedToken.isValid() || !session.isValid()) {
      return left(new SessionExpiredError());
    }

    const user = await this.userRepository.findUniqueById(session.userId);
    if (!user) return left(new UserNotFoundError());

    const workspaceUser =
      await this.workspaceUserRepository.findDefaultWorkspaceByUserId(user.id);
    if (!workspaceUser) return left(new SessionExpiredError());

    return right({ user, workspaceUser });
  }

  private async rotate(
    storedToken: RefreshToken,
    session: AuthSession,
    context: SessionContext,
  ): Promise<Either<Error, Response>> {
    const expiresAt = this.dateProvider.addDaysInCurrentDate(
      Number(env.USER_REFRESH_EXPIRES_IN),
    );

    const tokensOrError = await this.authTokenPairFactory.build({
      userId: context.user.id,
      userName: context.user.name,
      workspaceId: context.workspaceUser.user.workspaceId,
      workspaceName: context.workspaceUser.workspaceName,
      role: context.workspaceUser.user.role,
      sessionId: session.id,
      expiresAt,
    });
    if (tokensOrError.isLeft()) return left(tokensOrError.value);

    const rotated = await this.refreshTokensRepository.rotate(
      storedToken,
      tokensOrError.value.refreshToken,
    );
    if (!rotated) return this.revokeFamily(session);

    session.renew(expiresAt);
    await this.authSessionsRepository.save(session);

    return right({
      accessToken: tokensOrError.value.accessToken,
      refreshToken: tokensOrError.value.rawRefreshToken,
    });
  }

  private async revokeFamily(
    session: AuthSession,
  ): Promise<Either<Error, Response>> {
    await Promise.all([
      this.refreshTokensRepository.revokeBySessionId(session.id),
      this.authSessionsRepository.revoke(session.id),
    ]);

    return left(new SessionExpiredError());
  }
}
