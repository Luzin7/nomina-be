import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  DeleteGoalContributionParamsPipe,
  type DeleteGoalContributionParams,
} from './delete-goal-contribution.dto';
import { DeleteGoalContributionService } from './delete-goal-contribution.service';

@ApiTags('Goals')
@Controller('goals')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
export class DeleteGoalContributionController {
  constructor(private readonly service: DeleteGoalContributionService) {}

  @Delete(':id/contributions/:contributionId')
  @HttpCode(statusCode.NO_CONTENT)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param(DeleteGoalContributionParamsPipe)
    { id: goalId, contributionId }: DeleteGoalContributionParams,
  ) {
    const data = await this.service.execute({
      workspaceId,
      goalId,
      contributionId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }
  }
}
