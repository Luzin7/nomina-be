import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { AccountPresenter } from '@modules/account/presenters/Account.presenter';
import { Controller, Get, HttpCode, Query, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  ListAccountsPipe,
  type ListAccountsRequest,
} from './list-accounts.dto';
import { ListAccountsService } from './list-accounts.service';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class ListAccountsController {
  constructor(private readonly service: ListAccountsService) {}

  @Get()
  @HttpCode(statusCode.OK)
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Query(ListAccountsPipe) query: ListAccountsRequest,
  ) {
    const data = await this.service.execute({
      ...query,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return {
      data: {
        accounts: data.value.accounts.map(AccountPresenter.toListItemHTTP),
        total: data.value.total,
      },
    };
  }
}
