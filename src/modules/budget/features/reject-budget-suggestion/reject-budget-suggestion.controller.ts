import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { BudgetPresenter } from '@modules/budget/presenters/Budget.presenter';
import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  RejectBudgetSuggestionPipe,
  type RejectBudgetSuggestionRequest,
} from './reject-budget-suggestion.dto';
import { RejectBudgetSuggestionService } from './reject-budget-suggestion.handler';

@ApiTags('Budget')
@Controller('budget')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class RejectBudgetSuggestionController {
  constructor(private readonly service: RejectBudgetSuggestionService) {}

  @Post('suggestion/:kind/reject')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param(RejectBudgetSuggestionPipe) { kind }: RejectBudgetSuggestionRequest,
  ) {
    const data = await this.service.execute({ kind, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return BudgetPresenter.toDecision(data.value);
  }
}
