import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Idempotent } from '@providers/auth/decorators/Idempotency.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { MarkRecurringSuggestionsShownService } from './mark-recurring-suggestions-shown.service';
import {
  MarkSuggestionsShownPipe,
  type MarkSuggestionsShownRequest,
} from './recurring-suggestion.dto';

@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.USER)
@ApiTags('Recurring Suggestion')
@Controller('suggestion')
export class MarkRecurringSuggestionsShownController {
  constructor(private readonly service: MarkRecurringSuggestionsShownService) {}

  @Post('shown')
  @Idempotent()
  @HttpCode(statusCode.OK)
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Body(MarkSuggestionsShownPipe) body: MarkSuggestionsShownRequest,
  ) {
    const data = await this.service.execute({ workspaceId, ids: body.ids });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: data.value };
  }
}
