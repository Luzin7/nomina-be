import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { BalanceAdjustmentPresenter } from '@modules/account/presenters/BalanceAdjustment.presenter';
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
import { Idempotent } from '@providers/auth/decorators/Idempotency.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  AdjustAccountBalancePipe,
  type AdjustAccountBalanceRequest,
} from './adjust-account-balance.dto';
import { AdjustAccountBalanceService } from './adjust-account-balance.service';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
export class AdjustAccountBalanceController {
  constructor(private readonly service: AdjustAccountBalanceService) {}

  @Post(':id/balance-adjustments')
  @Idempotent()
  @HttpCode(statusCode.CREATED)
  async handle(
    @CurrentLoggedUser() { workspaceId, sub }: TokenPayloadSchema,
    @Param('id') accountId: string,
    @Body(AdjustAccountBalancePipe) body: AdjustAccountBalanceRequest,
  ) {
    const result = await this.service.execute({
      ...body,
      accountId,
      workspaceId,
      sub,
    });

    if (result.isLeft()) {
      return ErrorPresenter.toHTTP(result.value);
    }

    const { adjusted, adjustment } = result.value;

    return {
      data: {
        adjusted,
        adjustment: adjustment
          ? BalanceAdjustmentPresenter.toHTTP(adjustment)
          : null,
      },
    };
  }
}
