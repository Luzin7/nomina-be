import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { UpcomingInvoicesPresenter } from '@modules/account/presenters/UpcomingInvoices.presenter';
import { Controller, Get, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { GetUpcomingInvoicesService } from './get-upcoming-invoices.handler';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class GetUpcomingInvoicesController {
  constructor(private readonly service: GetUpcomingInvoicesService) {}

  @Get(':id/upcoming-invoices')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId, sub }: TokenPayloadSchema,
    @Param('id') accountId: string,
  ) {
    const data = await this.service.execute({ accountId, workspaceId, sub });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: UpcomingInvoicesPresenter.toHTTP(data.value) };
  }
}
