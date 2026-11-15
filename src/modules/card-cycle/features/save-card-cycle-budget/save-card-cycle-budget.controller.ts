import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { CardCyclePresenter } from '@modules/card-cycle/presenters/CardCycle.presenter';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Idempotent } from '@providers/auth/decorators/Idempotency.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  SaveCardCycleBudgetPipe,
  type SaveCardCycleBudgetRequest,
} from './save-card-cycle-budget.dto';
import { SaveCardCycleBudgetService } from './save-card-cycle-budget.handler';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class SaveCardCycleBudgetController {
  constructor(private readonly service: SaveCardCycleBudgetService) {}

  @Post(':id/cycle/limit')
  @Idempotent()
  @HttpCode(statusCode.CREATED)
  @ApiBody({
    description:
      'Cria o limite de um ciclo do cartão. `effectiveFrom` aceita o ciclo atual ou qualquer ciclo futuro.',
    examples: {
      currentCycle: {
        summary: 'Aplicar no ciclo atual',
        value: { effectiveFrom: '2026-12-28', limitCents: 250000 },
      },
    },
  })
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Param('id') accountId: string,
    @Body(SaveCardCycleBudgetPipe) body: SaveCardCycleBudgetRequest,
  ) {
    const data = await this.service.execute({
      ...body,
      accountId,
      workspaceId,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return { data: CardCyclePresenter.toLimit(data.value) };
  }
}
