import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { MonthPacePresenter } from '@modules/report/presenters/MonthPace.presenter';
import { Controller, Get, HttpCode, Query, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  GetMonthPacePipe,
  type GetMonthPaceRequest,
} from './get-month-pace.dto';
import { GetMonthPaceService } from './get-month-pace.handler';

@ApiTags('Report')
@Controller('report')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class GetMonthPaceController {
  constructor(private readonly service: GetMonthPaceService) {}

  @Get('month-pace')
  @HttpCode(statusCode.OK)
  @ApiQuery({ name: 'month', required: true, type: Number, example: 11 })
  @ApiQuery({ name: 'year', required: true, type: Number, example: 2026 })
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Query(GetMonthPacePipe) query: GetMonthPaceRequest,
  ) {
    const data = await this.service.execute({ ...query, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: MonthPacePresenter.toHTTP(data.value) };
  }
}
