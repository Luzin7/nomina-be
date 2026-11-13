import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Controller, Get, HttpCode, Query, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  ListTransactionTotalsPipe,
  type ListTransactionTotalsRequest,
} from './list-transaction-totals.dto';
import { ListTransactionTotalsService } from './list-transaction-totals.service';

@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
@ApiTags('Transaction')
@Controller('transaction')
export class ListTransactionTotalsController {
  constructor(private readonly service: ListTransactionTotalsService) {}

  @Get('list/totals')
  @HttpCode(statusCode.OK)
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    example: '2026-01-01',
    description: 'Formato YYYY-MM-DD',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    example: '2026-01-31',
    description: 'Formato YYYY-MM-DD',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['INCOME', 'EXPENSE', 'TRANSFER'],
  })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'COMPLETED'] })
  @ApiQuery({ name: 'categoryId', required: false, type: String })
  @ApiQuery({ name: 'accountId', required: false, type: String })
  @ApiQuery({ name: 'title', required: false, type: String })
  async handle(
    @CurrentLoggedUser() { sub, workspaceId }: TokenPayloadSchema,
    @Query(ListTransactionTotalsPipe) filters: ListTransactionTotalsRequest,
  ) {
    const data = await this.service.execute({ ...filters, sub, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: data.value };
  }
}
