import { MAX_REFRESH_TOKEN_SUCCESSOR_HOPS } from '@constants/auth';
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
import { Injectable, Logger } from '@nestjs/common';
import { RefreshTokenGenerator } from '@providers/cryptography/contracts/RefreshTokenGenerator';
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

type ActiveHead = {
  rawToken: string;
  storedToken: RefreshToken;
};

type RevocationReason =
  | 'reuse_after_grace'
  | 'revoked_token'
  | 'session_invalid'
  | 'broken_chain';

@Injectable()
export class RefreshTokenService implements Service<
  string | undefined,
  Error,
  Response
> {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly authSessionsRepository: AuthSessionsRepository,
    private readonly workspaceUserRepository: WorkspaceUserRepository,
    private readonly authTokenPairFactory: AuthTokenPairFactory,
    private readonly dateProvider: DateProvider,
    private readonly tokenHasher: TokenHasher,
    private readonly refreshTokenGenerator: RefreshTokenGenerator,
  ) {}

  async execute(
    refreshToken: string | undefined,
  ): Promise<Either<Error, Response>> {
    if (!refreshToken) return left(new SessionExpiredError());

    const storedOrError = await this.loadStoredSession(refreshToken);
    if (storedOrError.isLeft()) return left(storedOrError.value);

    const { storedToken, session } = storedOrError.value;
    if (!storedToken.isActive()) {
      return this.recoverReusedToken(storedToken, session, refreshToken);
    }

    return this.rotate(storedToken, session, refreshToken);
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
    const now = this.dateProvider.now();
    if (!storedToken.isValid(now) || !session.isValid(now)) {
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
    presentedRawToken: string,
  ): Promise<Either<Error, Response>> {
    const contextOrError = await this.resolveContext(storedToken, session);
    if (contextOrError.isLeft()) return left(contextOrError.value);

    const context = contextOrError.value;
    const expiresAt = this.dateProvider.addDaysInCurrentDate(
      Number(env.USER_REFRESH_EXPIRES_IN),
    );

    const tokensOrError = await this.authTokenPairFactory.build({
      ...this.claimsOf(context),
      sessionId: session.id,
      expiresAt,
      rawRefreshToken:
        this.refreshTokenGenerator.successorOf(presentedRawToken),
    });
    if (tokensOrError.isLeft()) return left(tokensOrError.value);

    const now = this.dateProvider.now();
    storedToken.markAsRotated(now);

    const rotated = await this.refreshTokensRepository.rotate(
      storedToken,
      tokensOrError.value.refreshToken,
    );
    if (!rotated) return this.recoverAfterLostRace(presentedRawToken);

    session.renew(expiresAt, now);
    await this.authSessionsRepository.renew(session);

    return right({
      accessToken: tokensOrError.value.accessToken,
      refreshToken: tokensOrError.value.rawRefreshToken,
    });
  }

  private async recoverAfterLostRace(
    presentedRawToken: string,
  ): Promise<Either<Error, Response>> {
    const reloadedOrError = await this.loadStoredSession(presentedRawToken);
    if (reloadedOrError.isLeft()) return left(reloadedOrError.value);

    const { storedToken: reloaded, session } = reloadedOrError.value;

    return this.recoverReusedToken(reloaded, session, presentedRawToken);
  }

  private async recoverReusedToken(
    storedToken: RefreshToken,
    session: AuthSession,
    presentedRawToken: string,
  ): Promise<Either<Error, Response>> {
    const now = this.dateProvider.now();
    if (storedToken.isRevoked()) {
      return this.revokeFamily(session, 'revoked_token');
    }
    if (!storedToken.isWithinReuseGrace(now)) {
      return this.revokeFamily(
        session,
        'reuse_after_grace',
        this.secondsSinceRotation(storedToken, now),
      );
    }
    if (!session.isValid(now))
      return this.revokeFamily(session, 'session_invalid');

    const head = await this.findHead(storedToken, presentedRawToken);
    if (!head) return this.revokeFamily(session, 'broken_chain');

    const contextOrError = await this.resolveContext(head.storedToken, session);
    if (contextOrError.isLeft()) return left(contextOrError.value);

    const accessToken = await this.authTokenPairFactory.signAccessToken(
      this.claimsOf(contextOrError.value),
    );

    return right({ accessToken, refreshToken: head.rawToken });
  }

  private async findHead(
    rotatedToken: RefreshToken,
    presentedRawToken: string,
  ): Promise<ActiveHead | null> {
    let rawToken = presentedRawToken;

    for (let hop = 0; hop < MAX_REFRESH_TOKEN_SUCCESSOR_HOPS; hop++) {
      rawToken = this.refreshTokenGenerator.successorOf(rawToken);
      const candidate =
        await this.refreshTokensRepository.findUniqueByTokenHash(
          this.tokenHasher.hash(rawToken),
        );
      if (!candidate || candidate.sessionId !== rotatedToken.sessionId) {
        return null;
      }
      if (candidate.isActive()) return { rawToken, storedToken: candidate };
      if (!candidate.isRotated()) return null;
    }

    return null;
  }

  private claimsOf(context: SessionContext) {
    return {
      userId: context.user.id,
      userName: context.user.name,
      workspaceId: context.workspaceUser.user.workspaceId,
      workspaceName: context.workspaceUser.workspaceName,
      role: context.workspaceUser.user.role,
    };
  }

  private secondsSinceRotation(
    storedToken: RefreshToken,
    now: Date,
  ): number | undefined {
    if (!storedToken.rotatedAt) return undefined;

    return Math.floor(
      (now.getTime() - storedToken.rotatedAt.getTime()) / 1_000,
    );
  }

  private async revokeFamily(
    session: AuthSession,
    reason: RevocationReason,
    secondsSinceRotation?: number,
  ): Promise<Either<Error, Response>> {
    const elapsed =
      secondsSinceRotation === undefined
        ? ''
        : ` secondsSinceRotation=${secondsSinceRotation}`;
    this.logger.warn(
      `Refresh token family revoked: sessionId=${session.id} userId=${session.userId} reason=${reason}${elapsed}`,
    );

    await Promise.all([
      this.refreshTokensRepository.revokeBySessionId(session.id),
      this.authSessionsRepository.revoke(session.id),
    ]);

    return left(new SessionExpiredError());
  }
}
