import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { RecurringSuggestionPresenter } from '@modules/transaction/presenters/RecurringSuggestion.presenter';
import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { ListRecurringSuggestionsService } from './list-recurring-suggestions.service';

@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
@ApiTags('Recurring Suggestion')
@Controller('suggestion')
export class ListRecurringSuggestionsController {
  constructor(private readonly service: ListRecurringSuggestionsService) {}

  @Get()
  @HttpCode(statusCode.OK)
  async handle(@CurrentLoggedUser() { workspaceId }: TokenPayloadSchema) {
    const data = await this.service.execute({ workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return {
      data: {
        suggestions: data.value.suggestions.map(
          RecurringSuggestionPresenter.toHTTP,
        ),
      },
    };
  }
}
