import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { TransactionPresenter } from '@modules/transaction/presenters/Transaction.presenter';
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
  SetTransactionStatusPipe,
  type SetTransactionStatusRequest,
} from './set-transaction-status.dto';
import { SetTransactionStatusService } from './set-transaction-status.service';

@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
@ApiTags('Transaction')
@Controller('transaction')
export class SetTransactionStatusController {
  constructor(private readonly service: SetTransactionStatusService) {}

  @Patch(':id/status')
  @HttpCode(statusCode.OK)
  async handle(
    @Param('id') transactionId: string,
    @Body(SetTransactionStatusPipe) body: SetTransactionStatusRequest,
    @CurrentLoggedUser() { sub, workspaceId }: TokenPayloadSchema,
  ) {
    const data = await this.service.execute({
      ...body,
      transactionId,
      sub,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: TransactionPresenter.toHTTP(data.value) };
  }
}
