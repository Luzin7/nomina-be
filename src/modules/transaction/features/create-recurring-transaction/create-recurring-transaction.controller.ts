import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { RecurringTransactionPresenter } from '@modules/transaction/presenters/RecurringTransaction.presenter';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  CreateRecurringTransactionPipe,
  type CreateRecurringTransactionRequest,
} from './create-recurring-transaction.dto';
import { CreateRecurringTransactionService } from './create-recurring-transaction.service';

@ApiTags('Recurring Transaction')
@Controller('transaction')
export class CreateRecurringTransactionController {
  constructor(private readonly service: CreateRecurringTransactionService) {}

  @Post('recurring')
  @HttpCode(statusCode.CREATED)
  async handle(
    @CurrentLoggedUser() { sub, workspaceId }: TokenPayloadSchema,
    @Body(CreateRecurringTransactionPipe)
    body: CreateRecurringTransactionRequest,
  ) {
    const data = await this.service.execute({
      ...body,
      sub,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: RecurringTransactionPresenter.toHTTP(data.value) };
  }
}
