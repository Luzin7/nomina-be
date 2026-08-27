import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { RecurringTransactionPresenter } from '@modules/transaction/presenters/RecurringTransaction.presenter';
import { Controller, HttpCode, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { ToggleActiveRecurringTransactionService } from './toggle-active-recurring-transaction.service';

@ApiTags('Recurring Transaction')
@Controller('transaction')
export class ToggleActiveRecurringTransactionController {
  constructor(
    private readonly toggleService: ToggleActiveRecurringTransactionService,
  ) {}

  @Patch('recurring/active/:recurringTransactionId')
  @HttpCode(statusCode.OK)
  async handle(
    @Param('recurringTransactionId') recurringTransactionId: string,
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
  ) {
    const data = await this.toggleService.execute({
      recurringTransactionId,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: RecurringTransactionPresenter.toHTTP(data.value) };
  }
}
