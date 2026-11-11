import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import {
  GoalsSummary,
  buildGoalsSummary,
} from '@modules/goal/valueObjects/GoalsSummary';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadSchema, 'workspaceId'>;

@Injectable()
export class GetGoalsSummaryService implements Service<
  Request,
  Error,
  GoalsSummary
> {
  constructor(private readonly goalRepository: GoalRepository) {}

  async execute({
    workspaceId,
  }: Request): Promise<Either<Error, GoalsSummary>> {
    await this.goalRepository.seedEmergencyGoal(workspaceId);

    const [aggregates, monthlyAporteCents] = await Promise.all([
      this.goalRepository.getSummaryAggregates(workspaceId),
      this.goalRepository.sumMonthlyAporteCents(workspaceId),
    ]);

    return right(buildGoalsSummary(monthlyAporteCents, aggregates));
  }
}
