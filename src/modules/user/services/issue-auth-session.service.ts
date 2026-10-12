import { UserRole } from '@constants/enums';
import { env } from '@infra/env';
import { AuthSession } from '@modules/user/entities/AuthSession';
import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { AuthTokenPairFactory } from '@modules/user/services/auth-token-pair.factory';
import { Injectable } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

export interface IssueAuthSessionRequest {
  userId: string;
  userName: string;
  workspaceId: string;
  workspaceName: string;
  role: UserRole;
  userAgent?: string | null;
}

export interface IssuedAuthSession {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class IssueAuthSessionService implements Service<
  IssueAuthSessionRequest,
  Error,
  IssuedAuthSession
> {
  constructor(
    private readonly authSessionsRepository: AuthSessionsRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly authTokenPairFactory: AuthTokenPairFactory,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(
    request: IssueAuthSessionRequest,
  ): Promise<Either<Error, IssuedAuthSession>> {
    const sessionOrError = await this.createSession(request);
    if (sessionOrError.isLeft()) return left(sessionOrError.value);

    const session = sessionOrError.value;
    const tokensOrError = await this.authTokenPairFactory.build({
      userId: request.userId,
      userName: request.userName,
      workspaceId: request.workspaceId,
      workspaceName: request.workspaceName,
      role: request.role,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    });
    if (tokensOrError.isLeft()) return left(tokensOrError.value);

    await this.refreshTokensRepository.create(tokensOrError.value.refreshToken);

    return right({
      accessToken: tokensOrError.value.accessToken,
      refreshToken: tokensOrError.value.rawRefreshToken,
    });
  }

  private async createSession(
    request: IssueAuthSessionRequest,
  ): Promise<Either<Error, AuthSession>> {
    const expiresAt = this.dateProvider.addDaysInCurrentDate(
      Number(env.USER_REFRESH_EXPIRES_IN),
    );

    const authSessionOrError = AuthSession.create({
      userId: request.userId,
      userAgent: request.userAgent ?? null,
      expiresAt,
    });
    if (authSessionOrError.isLeft()) return left(authSessionOrError.value);

    const session = await this.authSessionsRepository.create(
      authSessionOrError.value,
    );

    return right(session);
  }
}
