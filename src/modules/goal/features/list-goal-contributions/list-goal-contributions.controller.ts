import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { GoalContributionPresenter } from '@modules/goal/presenters/GoalContribution.presenter';
import { Controller, Get, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  ListGoalContributionsParamsPipe,
  type ListGoalContributionsParams,
} from './list-goal-contributions.dto';
import { ListGoalContributionsService } from './list-goal-contributions.service';

@ApiTags('Goals')
@Controller('goals')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class ListGoalContributionsController {
  constructor(private readonly service: ListGoalContributionsService) {}

  @Get(':id/contributions')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param(ListGoalContributionsParamsPipe)
    { id: goalId }: ListGoalContributionsParams,
  ) {
    const data = await this.service.execute({ workspaceId, goalId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return {
      data: data.value.contributions.map(GoalContributionPresenter.toHTTP),
    };
  }
}
