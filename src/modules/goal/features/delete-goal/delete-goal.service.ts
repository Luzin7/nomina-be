import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  EmergencyGoalNotDeletableError,
  GoalNotFoundError,
} from '@modules/goal/errors';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { invalidateGoalReads } from '@modules/goal/services/goal-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { DeleteGoalParams } from './delete-goal.dto';

type Request = DeleteGoalParams & Pick<TokenPayloadSchema, 'workspaceId'>;

@Injectable()
export class DeleteGoalService implements Service<Request, Error, void> {
  constructor(
    private readonly goalRepository: GoalRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute({ id, workspaceId }: Request): Promise<Either<Error, void>> {
    const goal = await this.goalRepository.findById(id, workspaceId);
    if (!goal) return left(new GoalNotFoundError());

    if (goal.isSystem) return left(new EmergencyGoalNotDeletableError());

    const deleted = await this.goalRepository.delete(id, workspaceId);
    if (!deleted) return left(new GoalNotFoundError());

    await invalidateGoalReads(this.cache, workspaceId, 'delete-goal');

    return right(undefined);
  }
}
