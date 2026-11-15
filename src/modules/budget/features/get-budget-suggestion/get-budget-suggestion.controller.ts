import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { BudgetPresenter } from '@modules/budget/presenters/Budget.presenter';
import { ResolveBudgetSuggestionService } from '@modules/budget/services/resolve-budget-suggestion.service';
import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';

@ApiTags('Budget')
@Controller('budget')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
export class GetBudgetSuggestionController {
  constructor(private readonly service: ResolveBudgetSuggestionService) {}

  @Get('suggestion')
  @HttpCode(statusCode.OK)
  async handle(@CurrentLoggedUser() { workspaceId }: TokenPayloadSchema) {
    const data = await this.service.execute({ workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return BudgetPresenter.toSuggestion(data.value);
  }
}
