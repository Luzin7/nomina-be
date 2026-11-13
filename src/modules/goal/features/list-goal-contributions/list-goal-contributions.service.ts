import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { GoalNotFoundError } from '@modules/goal/errors';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import {
  GOAL_CACHE_TTL_SECONDS,
  readGoalGeneration,
} from '@modules/goal/services/goal-cache';
import {
  GoalContributionRecord,
  GoalContributionRepository,
} from '@modules/goal/repositories/contracts/GoalContributionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readLedgerGeneration } from '@shared/cache/report-cache';
import { readThrough } from '@shared/cache/read-through';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadSchema, 'workspaceId'> & { goalId: string };

export type ListGoalContributionsResponse = {
  contributions: GoalContributionRecord[];
};

@Injectable()
export class ListGoalContributionsService implements Service<
  Request,
  Error,
  ListGoalContributionsResponse
> {
  constructor(
    private readonly goalRepository: GoalRepository,
    private readonly contributionRepository: GoalContributionRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
    goalId,
  }: Request): Promise<Either<Error, ListGoalContributionsResponse>> {
    const [goal, ledger] = await Promise.all([
      readGoalGeneration(this.cache, workspaceId),
      readLedgerGeneration(this.cache, workspaceId),
    ]);

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'goal:contributions',
        version: 'v1',
        workspaceId,
        generations: { ledger, goal },
        parts: [goalId],
      }),
      ttlSeconds: GOAL_CACHE_TTL_SECONDS,
      load: () => this.list(workspaceId, goalId),
    });
  }

  private async list(
    workspaceId: string,
    goalId: string,
  ): Promise<Either<Error, ListGoalContributionsResponse>> {
    const goal = await this.goalRepository.findById(goalId, workspaceId);
    if (!goal) return left(new GoalNotFoundError());

    const contributions =
      await this.contributionRepository.listContributionsByGoal(
        goalId,
        workspaceId,
      );

    return right({ contributions });
  }
}
