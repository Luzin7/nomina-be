import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { BudgetPresenter } from '@modules/budget/presenters/Budget.presenter';
import { Controller, Get, HttpCode, Query, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  GetBudgetStatusPipe,
  type GetBudgetStatusRequest,
} from './get-status.dto';
import { GetBudgetStatusService } from './get-status.handler';

@ApiTags('Budget')
@Controller('budget')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class GetBudgetStatusController {
  constructor(private readonly service: GetBudgetStatusService) {}

  @Get('status')
  @HttpCode(statusCode.OK)
  @ApiQuery({ name: 'month', required: true, type: Number, example: 11 })
  @ApiQuery({ name: 'year', required: true, type: Number, example: 2026 })
  async handle(
    @CurrentLoggedUser() { workspaceId, sub }: TokenPayloadSchema,
    @Query(GetBudgetStatusPipe) query: GetBudgetStatusRequest,
  ) {
    const data = await this.service.execute({ ...query, workspaceId, sub });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return BudgetPresenter.toStatus(data.value);
  }
}
