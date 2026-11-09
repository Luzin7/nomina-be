import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Idempotent } from '@providers/auth/decorators/Idempotency.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { AcceptRecurringSuggestionService } from './accept-recurring-suggestion.service';
import {
  AcceptSuggestionBodyPipe,
  SuggestionIdParamPipe,
  type AcceptSuggestionBody,
  type SuggestionIdParam,
} from './recurring-suggestion.dto';

@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
@ApiTags('Recurring Suggestion')
@Controller('suggestion')
export class AcceptRecurringSuggestionController {
  constructor(private readonly service: AcceptRecurringSuggestionService) {}

  @Post(':id/accept')
  @Idempotent()
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param(SuggestionIdParamPipe) { id }: SuggestionIdParam,
    @Body(AcceptSuggestionBodyPipe) body: AcceptSuggestionBody,
  ) {
    const data = await this.service.execute({
      workspaceId,
      suggestionId: id,
      title: body.title,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { recurringId: data.value.recurringId };
  }
}
