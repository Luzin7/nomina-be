import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { GoalPresenter } from '@modules/goal/presenters/Goal.presenter';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { CreateGoalPipe, type CreateGoalRequest } from './create-goal.dto';
import { CreateGoalService } from './create-goal.service';

@ApiTags('Goals')
@Controller('goals')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
export class CreateGoalController {
  constructor(private readonly service: CreateGoalService) {}

  @Post()
  @HttpCode(statusCode.CREATED)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Body(CreateGoalPipe) body: CreateGoalRequest,
  ) {
    const data = await this.service.execute({ ...body, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    const { goal, now, timezone } = data.value;

    return { data: GoalPresenter.toHTTP(goal, { now, timezone }) };
  }
}
