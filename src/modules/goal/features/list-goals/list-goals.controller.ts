import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { GoalPresenter } from '@modules/goal/presenters/Goal.presenter';
import { GoalsSummaryPresenter } from '@modules/goal/presenters/GoalsSummary.presenter';
import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { ListGoalsService } from './list-goals.service';

@ApiTags('Goals')
@Controller('goals')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class ListGoalsController {
  constructor(private readonly service: ListGoalsService) {}

  @Get()
  @HttpCode(statusCode.OK)
  async handle(@CurrentLoggedUser() { workspaceId }: TokenPayloadSchema) {
    const data = await this.service.execute({ workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    const { goals, summary, now, timezone } = data.value;

    return {
      goals: goals.map((goal) => GoalPresenter.toHTTP(goal, { now, timezone })),
      summary: GoalsSummaryPresenter.toHTTP(summary),
    };
  }
}
