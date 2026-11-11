import { Goal } from '@modules/goal/entities/Goal';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import {
  GoalsSummary,
  buildGoalsSummary,
} from '@modules/goal/valueObjects/GoalsSummary';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
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
  ) {}

  async execute({
    workspaceId,
  }: Request): Promise<Either<Error, ListGoalsResponse>> {
    await this.goalRepository.seedEmergencyGoal(workspaceId);

    const [records, aggregates, monthlyAporteCents] = await Promise.all([
      this.goalRepository.listByWorkspace(workspaceId),
      this.goalRepository.getSummaryAggregates(workspaceId),
      this.goalRepository.sumMonthlyAporteCents(workspaceId),
    ]);

    const timezone = await this.workspaceTimezone.execute(workspaceId);

    return right({
      goals: records.map(Goal.fromRecord),
      summary: buildGoalsSummary(monthlyAporteCents, aggregates),
      now: this.dateProvider.now(),
      timezone,
    });
  }
}
