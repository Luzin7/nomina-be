import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { GoalContributionPresenter } from '@modules/goal/presenters/GoalContribution.presenter';
import { GoalPresenter } from '@modules/goal/presenters/Goal.presenter';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  CreateGoalContributionParamsPipe,
  CreateGoalContributionPipe,
  type CreateGoalContributionParams,
  type CreateGoalContributionRequest,
} from './create-goal-contribution.dto';
import { CreateGoalContributionService } from './create-goal-contribution.service';

@ApiTags('Goals')
@Controller('goals')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
export class CreateGoalContributionController {
  constructor(private readonly service: CreateGoalContributionService) {}

  @Post(':id/contributions')
  @HttpCode(statusCode.CREATED)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param(CreateGoalContributionParamsPipe)
    { id: goalId }: CreateGoalContributionParams,
    @Body(CreateGoalContributionPipe) body: CreateGoalContributionRequest,
  ) {
    const data = await this.service.execute({ ...body, goalId, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    const { contribution, goal, now, timezone } = data.value;

    return {
      data: {
        contribution: GoalContributionPresenter.toHTTP(contribution),
        goal: GoalPresenter.toHTTP(goal, { now, timezone }),
      },
    };
  }
}
