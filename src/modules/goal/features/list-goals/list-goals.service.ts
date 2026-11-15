import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { readLedgerGeneration } from '@shared/cache/report-cache';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Goal } from '@modules/goal/entities/Goal';
import {
  GOAL_CACHE_TTL_SECONDS,
  readGoalGeneration,
} from '@modules/goal/services/goal-cache';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import {
  GoalsSummary,
  buildGoalsSummary,
} from '@modules/goal/valueObjects/GoalsSummary';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { createStructuredCodec } from '@shared/cache/cache-codec';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadSchema, 'workspaceId'>;

export type ListGoalsResponse = {
  goals: Goal[];
  summary: GoalsSummary;
  now: Date;
  timezone: string;
};

@Injectable()
export class ListGoalsService implements Service<
  Request,
  Error,
  ListGoalsResponse
> {
  constructor(
    private readonly goalRepository: GoalRepository,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
  }: Request): Promise<Either<Error, ListGoalsResponse>> {
    const [goal, ledger, category] = await Promise.all([
      readGoalGeneration(this.cache, workspaceId),
      readLedgerGeneration(this.cache, workspaceId),
      readCategoryGeneration(this.cache, workspaceId),
    ]);
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    const localDay = this.dateProvider.format(
      this.dateProvider.now(),
      'YYYY-MM-DD',
      timezone,
    );

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'goal:list',
        version: 'v2',
        workspaceId,
        generations: { ledger, goal, category },
        parts: [localDay],
      }),
      ttlSeconds: GOAL_CACHE_TTL_SECONDS,
      codec: createStructuredCodec<ListGoalsResponse>([Goal]),
      load: () => this.list(workspaceId, timezone),
    });
  }

  private async list(
    workspaceId: string,
    timezone: string,
  ): Promise<Either<Error, ListGoalsResponse>> {
    await this.goalRepository.seedEmergencyGoal(workspaceId);

    const [records, aggregates, monthlyAporteCents] = await Promise.all([
      this.goalRepository.listByWorkspace(workspaceId),
      this.goalRepository.getSummaryAggregates(workspaceId),
      this.goalRepository.sumMonthlyAporteCents(workspaceId),
    ]);

    return right({
      goals: records.map(Goal.fromRecord),
      summary: buildGoalsSummary(monthlyAporteCents, aggregates),
      now: this.dateProvider.now(),
      timezone,
    });
  }
}
