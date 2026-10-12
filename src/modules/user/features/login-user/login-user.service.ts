import { User } from '@modules/user/entities/User';
import {
  InvalidUserAgentError,
  WrongCredentialsError,
} from '@modules/user/errors';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import {
  IssuedAuthSession,
  IssueAuthSessionService,
} from '@modules/user/services/issue-auth-session.service';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Injectable } from '@nestjs/common';
import { HashComparer } from '@providers/cryptography/contracts/HashComparer';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { LoginUserRequest } from './login-user.dto';

type Request = LoginUserRequest & { agent?: string };
type Response = IssuedAuthSession;

@Injectable()
export class LoginUserService implements Service<Request, Error, Response> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly workspaceUserRepository: WorkspaceUserRepository,
    private readonly issueAuthSessionService: IssueAuthSessionService,
    private readonly hashComparer: HashComparer,
  ) {}

  async execute({
    email,
    password,
    agent,
  }: Request): Promise<Either<Error, Response>> {
    const userAgentOrError = this.resolveUserAgent(agent);
    if (userAgentOrError.isLeft()) return left(userAgentOrError.value);

    const userOrError = await this.validateCredentials(email, password);
    if (userOrError.isLeft()) return left(userOrError.value);

    const user = userOrError.value;
    const defaultWorkspaceUser =
      await this.workspaceUserRepository.findDefaultWorkspaceByUserId(user.id);
    if (!defaultWorkspaceUser) return left(new UnauthorizedError());

    return this.issueAuthSessionService.execute({
      userId: user.id,
      userName: user.name,
      workspaceId: defaultWorkspaceUser.user.workspaceId,
      workspaceName: defaultWorkspaceUser.workspaceName,
      role: defaultWorkspaceUser.user.role,
      userAgent: userAgentOrError.value,
    });
  }

  private async validateCredentials(
    email: string,
    password: string,
  ): Promise<Either<Error, User>> {
    const user = await this.userRepository.findUniqueByEmail(email);
    if (!user) return left(new WrongCredentialsError());

    const isPasswordValid = await this.hashComparer.compare(
      password,
      user.passwordHash,
    );
    if (!isPasswordValid) return left(new WrongCredentialsError());

    return right(user);
  }

  private resolveUserAgent(
    agent: string | undefined,
  ): Either<Error, string | null> {
    if (!agent) return right(null);
    if (agent.trim().length === 0) return left(new InvalidUserAgentError());

    return right(agent.trim());
  }
}
