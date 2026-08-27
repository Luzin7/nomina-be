import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { RecurringTransactionPresenter } from '@modules/transaction/presenters/RecurringTransaction.presenter';
import { Body, Controller, HttpCode, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  UpdateRecurringTransactionPipe,
  type UpdateRecurringTransactionRequest,
} from './update-recurring-transaction.dto';
import { UpdateRecurringTransactionService } from './update-recurring-transaction.service';

@ApiTags('Recurring Transaction')
@Controller('transaction')
export class UpdateRecurringTransactionController {
  constructor(private readonly service: UpdateRecurringTransactionService) {}

  @Patch('recurring/:recurringTransactionId')
  @HttpCode(statusCode.OK)
  async handle(
    @Param('recurringTransactionId') recurringTransactionId: string,
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Body(UpdateRecurringTransactionPipe)
    body: UpdateRecurringTransactionRequest,
  ) {
    const data = await this.service.execute({
      ...body,
      recurringTransactionId,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: RecurringTransactionPresenter.toHTTP(data.value) };
  }
}
