import { Goal } from '@modules/goal/entities/Goal';
import { GoalNotFoundError } from '@modules/goal/errors';
import {
  GoalRecord,
  GoalRepository,
  UpdateGoalInput,
} from '@modules/goal/repositories/contracts/GoalRepository';
import { ValidateGoalLinksService } from '@modules/goal/services/validate-goal-links.service';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UpdateGoalRequest } from './update-goal.dto';

type Request = UpdateGoalRequest &
  Pick<TokenPayloadSchema, 'workspaceId'> & { id: string };

export type UpdateGoalResponse = {
  goal: Goal;
  now: Date;
  timezone: string;
};

@Injectable()
export class UpdateGoalService implements Service<
  Request,
  Error,
  UpdateGoalResponse
> {
  constructor(
    private readonly goalRepository: GoalRepository,
    private readonly validateGoalLinks: ValidateGoalLinksService,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, UpdateGoalResponse>> {
    const { id, workspaceId, ...body } = request;

    const name = resolveName(body.name);
    if (name.isLeft()) return left(name.value);

    const linkError = await this.validateGoalLinks.execute(workspaceId, body);
    if (linkError) return left(linkError);

    const now = this.dateProvider.now();
    const updated = await this.goalRepository.findByIdForUpdate(
      id,
      workspaceId,
      (current) => buildUpdateInput(current, body, name.value, now),
    );

    if (!updated) return left(new GoalNotFoundError());

    const timezone = await this.workspaceTimezone.execute(workspaceId);

    return right({
      goal: Goal.fromRecord(updated),
      now,
      timezone,
    });
  }
}

function resolveName(
  name: string | undefined,
): Either<Error, string | undefined> {
  if (name === undefined) return right(undefined);

  return Goal.normalizeName(name);
}

function buildUpdateInput(
  current: GoalRecord,
  body: UpdateGoalRequest,
  name: string | undefined,
  now: Date,
): UpdateGoalInput {
  return {
    name,
    targetCents: body.targetCents,
    currentCents: body.currentCents,
    monthlyAporteCents: body.monthlyAporteCents,
    linkedAccountId: body.linkedAccountId,
    categoryId: body.categoryId,
    dismissedAt: resolveDismissedAt(current, body, now),
  };
}

function resolveDismissedAt(
  current: GoalRecord,
  body: UpdateGoalRequest,
  now: Date,
): Date | null {
  if (body.targetCents !== undefined && body.targetCents > 0) return null;
  if (body.dismissed === true) return now;
  if (body.dismissed === false) return null;

  return current.dismissedAt;
}
