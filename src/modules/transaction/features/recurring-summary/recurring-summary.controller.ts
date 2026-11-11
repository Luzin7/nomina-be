import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import { RecurringSummaryService } from './recurring-summary.service';

@ApiTags('Recurring Transaction')
@Controller('transaction/recurring')
export class RecurringSummaryController {
  constructor(private readonly service: RecurringSummaryService) {}

  @Get('summary')
  @HttpCode(statusCode.OK)
  async handle(@CurrentLoggedUser() { workspaceId }: TokenPayloadSchema) {
    const data = await this.service.execute({ workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: data.value };
  }
}
