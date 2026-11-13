import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Goal } from '@modules/goal/entities/Goal';
import {
  GoalContributionIdConflictError,
  GoalNotFoundError,
} from '@modules/goal/errors';
import {
  GoalContributionRecord,
  GoalContributionRepository,
} from '@modules/goal/repositories/contracts/GoalContributionRepository';
import { invalidateGoalReads } from '@modules/goal/services/goal-cache';
import { ValidateGoalLinksService } from '@modules/goal/services/validate-goal-links.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { CreateGoalContributionRequest } from './create-goal-contribution.dto';

type Request = CreateGoalContributionRequest &
  Pick<TokenPayloadSchema, 'workspaceId'> & { goalId: string };

export type CreateGoalContributionResponse = {
  contribution: GoalContributionRecord;
  goal: Goal;
  now: Date;
  timezone: string;
};

@Injectable()
export class CreateGoalContributionService implements Service<
  Request,
  Error,
  CreateGoalContributionResponse
> {
  constructor(
    private readonly contributionRepository: GoalContributionRepository,
    private readonly validateGoalLinks: ValidateGoalLinksService,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    workspaceId,
    goalId,
    id,
    amountCents,
    sourceAccountId,
  }: Request): Promise<Either<Error, CreateGoalContributionResponse>> {
    const linkError = await this.validateGoalLinks.execute(workspaceId, {
      linkedAccountId: sourceAccountId,
    });
    if (linkError) return left(linkError);

    const result = await this.contributionRepository.recordContribution({
      id,
      workspaceId,
      goalId,
      amountCents,
      sourceAccountId: sourceAccountId ?? null,
    });

    if (result.status === 'id-conflict') {
      return left(new GoalContributionIdConflictError());
    }
    if (result.status === 'goal-not-found')
      return left(new GoalNotFoundError());

    if (result.status === 'recorded') {
      await invalidateGoalReads(
        this.cache,
        workspaceId,
        'create-goal-contribution',
      );
    }

    return right({
      contribution: result.contribution,
      goal: Goal.fromRecord(result.goal),
      now: this.dateProvider.now(),
      timezone: await this.workspaceTimezone.execute(workspaceId),
    });
  }
}
