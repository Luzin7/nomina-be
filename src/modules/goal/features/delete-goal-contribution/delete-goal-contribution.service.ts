import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  GoalContributionNotFoundError,
  GoalContributionUndoConflictError,
  GoalNotFoundError,
} from '@modules/goal/errors';
import { GoalContributionRepository } from '@modules/goal/repositories/contracts/GoalContributionRepository';
import { invalidateGoalReads } from '@modules/goal/services/goal-cache';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadSchema, 'workspaceId'> & {
  goalId: string;
  contributionId: string;
};

const FAILURES = {
  'goal-not-found': () => new GoalNotFoundError(),
  'contribution-not-found': () => new GoalContributionNotFoundError(),
  'undo-conflict': () => new GoalContributionUndoConflictError(),
};

@Injectable()
export class DeleteGoalContributionService implements Service<
  Request,
  Error,
  void
> {
  constructor(
    private readonly contributionRepository: GoalContributionRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
    goalId,
    contributionId,
  }: Request): Promise<Either<Error, void>> {
    const { status } = await this.contributionRepository.undoContribution({
      id: contributionId,
      goalId,
      workspaceId,
    });

    if (status !== 'undone') return left(FAILURES[status]());

    await invalidateGoalReads(
      this.cache,
      workspaceId,
      'delete-goal-contribution',
    );

    return right(undefined);
  }
}
