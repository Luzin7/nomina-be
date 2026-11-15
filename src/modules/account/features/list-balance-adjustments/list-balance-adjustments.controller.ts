import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { BalanceAdjustmentPresenter } from '@modules/account/presenters/BalanceAdjustment.presenter';
import { Controller, Get, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { ListBalanceAdjustmentsService } from './list-balance-adjustments.service';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class ListBalanceAdjustmentsController {
  constructor(private readonly service: ListBalanceAdjustmentsService) {}

  @Get(':id/balance-adjustments')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param('id') accountId: string,
  ) {
    const result = await this.service.execute({ accountId, workspaceId });

    if (result.isLeft()) {
      return ErrorPresenter.toHTTP(result.value);
    }

    return { data: result.value.map(BalanceAdjustmentPresenter.toHTTP) };
  }
}
