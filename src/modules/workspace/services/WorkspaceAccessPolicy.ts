import { UserRole } from '@constants/enums';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { Injectable } from '@nestjs/common';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';

@Injectable()
export class WorkspaceAccessPolicy {
  requireRole(
    membership: WorkspaceUser | null,
    allowed: UserRole[],
  ): Either<UnauthorizedError, null> {
    if (!membership) {
      return left(
        new UnauthorizedError('Usuário não tem acesso a esse workspace'),
      );
    }

    if (!allowed.includes(membership.role)) {
      return left(
        new UnauthorizedError(
          'Seu papel no workspace não permite executar essa ação',
        ),
      );
    }

    return right(null);
  }
}
