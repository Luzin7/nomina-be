import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { OpenCardInvoicePresenter } from '@modules/account/presenters/OpenCardInvoice.presenter';
import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { ListOpenCardInvoicesService } from './list-open-card-invoices.handler';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class ListOpenCardInvoicesController {
  constructor(private readonly service: ListOpenCardInvoicesService) {}

  @Get('invoices/open')
  @HttpCode(statusCode.OK)
  async handle(@CurrentLoggedUser() { workspaceId }: TokenPayloadSchema) {
    const data = await this.service.execute({ workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return {
      data: {
        invoices: data.value.invoices.map(OpenCardInvoicePresenter.toHTTP),
      },
    };
  }
}
