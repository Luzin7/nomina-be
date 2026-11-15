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
  GetCardCyclePeriodsPipe,
  type GetCardCyclePeriodsRequest,
} from './get-card-cycle-periods.dto';
import { GetCardCyclePeriodsService } from './get-card-cycle-periods.handler';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class GetCardCyclePeriodsController {
  constructor(private readonly service: GetCardCyclePeriodsService) {}

  @Get(':id/cycle/periods')
  @HttpCode(statusCode.OK)
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 12,
  })
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param('id') accountId: string,
    @Query(GetCardCyclePeriodsPipe) query: GetCardCyclePeriodsRequest,
  ) {
    const data = await this.service.execute({
      ...query,
      accountId,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: CardCyclePresenter.toPeriods(data.value) };
  }
}
