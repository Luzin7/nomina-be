import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { AccountPresenter } from '@modules/account/presenters/Account.presenter';
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
import { SetAutopayPipe, type SetAutopayRequest } from './set-autopay.dto';
import { SetAutopayService } from './set-autopay.service';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class SetAutopayController {
  constructor(private readonly service: SetAutopayService) {}

  @Patch(':id/autopay')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param('id') accountId: string,
    @Body(SetAutopayPipe) body: SetAutopayRequest,
  ) {
    const data = await this.service.execute({
      ...body,
      accountId,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return {
      data: AccountPresenter.toAutopayHTTP(data.value),
    };
  }
}
