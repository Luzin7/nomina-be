import { CreateGoalRequest } from '@modules/goal/features/create-goal/create-goal.dto';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Goal } from '@modules/goal/entities/Goal';
import { GoalRepository } from '@modules/goal/repositories/contracts/GoalRepository';
import { invalidateGoalReads } from '@modules/goal/services/goal-cache';
import { ValidateGoalLinksService } from '@modules/goal/services/validate-goal-links.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';

type Request = CreateGoalRequest & Pick<TokenPayloadSchema, 'workspaceId'>;

export type CreateGoalResponse = {
  goal: Goal;
  now: Date;
  timezone: string;
};

@Injectable()
export class CreateGoalService implements Service<
  Request,
  Error,
  CreateGoalResponse
> {
  constructor(
    private readonly goalRepository: GoalRepository,
    private readonly validateGoalLinks: ValidateGoalLinksService,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, CreateGoalResponse>> {
    const { workspaceId } = request;
    const name = Goal.normalizeName(request.name);
    if (name.isLeft()) return left(name.value);

    const linkError = await this.validateGoalLinks.execute(
      workspaceId,
      request,
    );
    if (linkError) return left(linkError);

    const created = await this.goalRepository.create({
      workspaceId,
      name: name.value,
      targetCents: request.targetCents,
      currentCents: request.currentCents ?? 0,
      monthlyAporteCents: request.monthlyAporteCents ?? 0,
      linkedAccountId: request.linkedAccountId ?? null,
      categoryId: request.categoryId ?? null,
    });

    await invalidateGoalReads(this.cache, workspaceId, 'create-goal');

    const timezone = await this.workspaceTimezone.execute(workspaceId);

    return right({
      goal: Goal.fromRecord(created),
      now: this.dateProvider.now(),
      timezone,
    });
  }
}
