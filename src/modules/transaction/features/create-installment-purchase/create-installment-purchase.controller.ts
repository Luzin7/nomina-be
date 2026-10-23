import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { InstallmentPurchasePresenter } from '@modules/transaction/presenters/InstallmentPurchase.presenter';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Idempotent } from '@providers/auth/decorators/Idempotency.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  CreateInstallmentPurchasePipe,
  type CreateInstallmentPurchaseRequest,
} from './create-installment-purchase.dto';
import { CreateInstallmentPurchaseService } from './create-installment-purchase.service';

@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
@ApiTags('Transaction')
@Controller('transaction')
export class CreateInstallmentPurchaseController {
  constructor(private readonly service: CreateInstallmentPurchaseService) {}

  @Post('installment-purchase')
  @Idempotent()
  @HttpCode(statusCode.CREATED)
  async handle(
    @CurrentLoggedUser() { sub, workspaceId }: TokenPayloadSchema,
    @Body(CreateInstallmentPurchasePipe)
    body: CreateInstallmentPurchaseRequest,
  ) {
    const data = await this.service.execute({ ...body, sub, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: InstallmentPurchasePresenter.toHTTP(data.value) };
  }
}
