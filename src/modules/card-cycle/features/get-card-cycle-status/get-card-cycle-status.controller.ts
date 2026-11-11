import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { CardCyclePresenter } from '@modules/card-cycle/presenters/CardCycle.presenter';
import {
  Controller,
  Get,
  HttpCode,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  GetCardCycleStatusPipe,
  type GetCardCycleStatusRequest,
} from './get-card-cycle-status.dto';
import { GetCardCycleStatusService } from './get-card-cycle-status.handler';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class GetCardCycleStatusController {
  constructor(private readonly service: GetCardCycleStatusService) {}

  @Get(':id/cycle')
  @HttpCode(statusCode.OK)
  @ApiQuery({
    name: 'dueDate',
    required: false,
    type: String,
    example: '2026-12-28',
  })
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param('id') accountId: string,
    @Query(GetCardCycleStatusPipe) query: GetCardCycleStatusRequest,
  ) {
    const data = await this.service.execute({
      ...query,
      accountId,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: CardCyclePresenter.toStatus(data.value) };
  }
}
