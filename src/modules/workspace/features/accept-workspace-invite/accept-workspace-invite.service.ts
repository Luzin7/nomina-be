import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import {
  ConflictWorkspaceUserError,
  InviteAlreadyUsedError,
  InviteExpiredError,
  InviteNotFoundError,
} from '@modules/workspace/errors';
import { WorkspaceInviteRepository } from '@modules/workspace/repositories/contracts/WorkspaceInviteRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { AcceptWorkspaceInviteRequest } from './accept-workspace-invite.dto';

type Request = AcceptWorkspaceInviteRequest & Pick<TokenPayloadSchema, 'sub'>;

@Injectable()
export class AcceptWorkspaceInviteService implements Service<
  Request,
  Error,
  WorkspaceUser
> {
  constructor(
    private readonly workspaceInviteRepository: WorkspaceInviteRepository,
    private readonly workspaceUserRepository: WorkspaceUserRepository,
  ) {}

  async execute({ code, sub }: Request): Promise<Either<Error, WorkspaceUser>> {
    const invite = await this.workspaceInviteRepository.findByCode(
      code.trim().toUpperCase(),
    );

    if (!invite) {
      return left(new InviteNotFoundError());
    }

    if (invite.usedAt !== null) {
      return left(new InviteAlreadyUsedError());
    }

    if (invite.expiresAt < new Date()) {
      return left(new InviteExpiredError());
    }

    const isAlreadyMember =
      await this.workspaceUserRepository.findUserByWorkspaceAndUserId(
        invite.workspaceId,
        sub,
      );

    if (isAlreadyMember) {
      return left(new ConflictWorkspaceUserError());
    }

    const workspaceUserOrError = WorkspaceUser.create({
      workspaceId: invite.workspaceId,
      userId: sub,
      role: invite.role,
      isDefault: false,
      joinedAt: new Date(),
    });

    if (workspaceUserOrError.isLeft()) {
      return left(workspaceUserOrError.value);
    }

    const workspaceUser = workspaceUserOrError.value;

    const outcome = await this.workspaceInviteRepository.accept(
      invite,
      workspaceUser,
    );

    if (outcome === 'already_used') {
      return left(new InviteAlreadyUsedError());
    }

    if (outcome === 'already_member') {
      return left(new ConflictWorkspaceUserError());
    }

    return right(workspaceUser);
  }
}
