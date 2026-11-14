import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { GetAvailableToSpendService } from './get-available-to-spend.handler';

@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class GetAvailableToSpendController {
  constructor(private readonly service: GetAvailableToSpendService) {}

  @Get('available-to-spend')
  @HttpCode(statusCode.OK)
  async handle(@CurrentLoggedUser() { workspaceId, sub }: TokenPayloadSchema) {
    const data = await this.service.execute({ workspaceId, sub });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return data.value;
  }
}
