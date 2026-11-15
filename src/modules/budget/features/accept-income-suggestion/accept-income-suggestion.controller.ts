import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { BudgetPresenter } from '@modules/budget/presenters/Budget.presenter';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  AcceptIncomeSuggestionPipe,
  type AcceptIncomeSuggestionRequest,
} from './accept-income-suggestion.dto';
import { AcceptIncomeSuggestionService } from './accept-income-suggestion.handler';

@ApiTags('Budget')
@Controller('budget')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class AcceptIncomeSuggestionController {
  constructor(private readonly service: AcceptIncomeSuggestionService) {}

  @Post('suggestion/income/accept')
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Body(AcceptIncomeSuggestionPipe) body: AcceptIncomeSuggestionRequest,
  ) {
    const data = await this.service.execute({ ...body, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return BudgetPresenter.toDecision(data.value);
  }
}
