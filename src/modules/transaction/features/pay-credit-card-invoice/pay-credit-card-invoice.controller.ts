import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { TransactionPresenter } from '@modules/transaction/presenters/Transaction.presenter';
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
  PayCreditCardInvoicePipe,
  type PayCreditCardInvoiceRequest,
} from './pay-credit-card-invoice.dto';
import { PayCreditCardInvoiceService } from './pay-credit-card-invoice.service';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class PayCreditCardInvoiceController {
  constructor(private readonly service: PayCreditCardInvoiceService) {}

  @Post(':id/invoice/pay')
  @Idempotent()
  @HttpCode(statusCode.CREATED)
  async handle(
    @CurrentLoggedUser() { workspaceId, sub }: TokenPayloadSchema,
    @Param('id') creditCardAccountId: string,
    @Body(PayCreditCardInvoicePipe) body: PayCreditCardInvoiceRequest,
  ) {
    const data = await this.service.execute({
      ...body,
      creditCardAccountId,
      workspaceId,
      sub,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return {
      data: TransactionPresenter.toHTTP(data.value),
    };
  }
}
