import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { readLedgerGeneration } from '@shared/cache/report-cache';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  GOAL_CACHE_TTL_SECONDS,
  readGoalGeneration,
} from '@modules/goal/services/goal-cache';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import {
  GoalsSummary,
  buildGoalsSummary,
} from '@modules/goal/valueObjects/GoalsSummary';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadSchema, 'workspaceId'>;

@Injectable()
export class GetGoalsSummaryService implements Service<
  Request,
  Error,
  GoalsSummary
> {
  constructor(
    private readonly goalRepository: GoalRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
  }: Request): Promise<Either<Error, GoalsSummary>> {
    const [goal, ledger, category] = await Promise.all([
      readGoalGeneration(this.cache, workspaceId),
      readLedgerGeneration(this.cache, workspaceId),
      readCategoryGeneration(this.cache, workspaceId),
    ]);

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'goal:summary',
        version: 'v2',
        workspaceId,
        generations: { ledger, goal, category },
      }),
      ttlSeconds: GOAL_CACHE_TTL_SECONDS,
      load: () => this.summarize(workspaceId),
    });
  }

  private async summarize(
    workspaceId: string,
  ): Promise<Either<Error, GoalsSummary>> {
    await this.goalRepository.seedEmergencyGoal(workspaceId);

    const [aggregates, monthlyAporteCents] = await Promise.all([
      this.goalRepository.getSummaryAggregates(workspaceId),
      this.goalRepository.sumMonthlyAporteCents(workspaceId),
    ]);

    return right(buildGoalsSummary(monthlyAporteCents, aggregates));
  }
}
