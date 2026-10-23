import { RecurringKind } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { RecurringTransactionPresenter } from '@modules/transaction/presenters/RecurringTransaction.presenter';
import { Controller, Get, HttpCode, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  ListRecurringTransactionsPipe,
  type ListRecurringTransactionsRequest,
} from './list-recurring-transactions.dto';
import { ListRecurringTransactionsService } from './list-recurring-transactions.service';

@ApiTags('Recurring Transaction')
@Controller('transaction')
export class ListRecurringTransactionsController {
  constructor(private readonly service: ListRecurringTransactionsService) {}

  @Get('recurring')
  @HttpCode(statusCode.OK)
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    type: Boolean,
    example: false,
  })
  @ApiQuery({
    name: 'kind',
    required: false,
    enum: RecurringKind,
    example: RecurringKind.INSTALLMENT,
  })
  async handle(
    @CurrentLoggedUser() { sub, workspaceId }: TokenPayloadSchema,
    @Query(ListRecurringTransactionsPipe)
    { page, pageSize, activeOnly, kind }: ListRecurringTransactionsRequest,
  ) {
    const data = await this.service.execute({
      page,
      pageSize,
      sub,
      workspaceId,
      activeOnly,
      kind,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return {
      data: {
        recurrings: data.value.recurrings.map(
          RecurringTransactionPresenter.toHTTP,
        ),
        total: data.value.total,
      },
    };
  }
}
