import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { GoalPresenter } from '@modules/goal/presenters/Goal.presenter';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  UpdateGoalParamsPipe,
  UpdateGoalPipe,
  type UpdateGoalParams,
  type UpdateGoalRequest,
} from './update-goal.dto';
import { UpdateGoalService } from './update-goal.service';

@ApiTags('Goals')
@Controller('goals')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
export class UpdateGoalController {
  constructor(private readonly service: UpdateGoalService) {}

  @Patch(':id')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param(UpdateGoalParamsPipe) { id }: UpdateGoalParams,
    @Body(UpdateGoalPipe) body: UpdateGoalRequest,
  ) {
    const data = await this.service.execute({ ...body, id, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    const { goal, now, timezone } = data.value;

    return { data: GoalPresenter.toHTTP(goal, { now, timezone }) };
  }
}
