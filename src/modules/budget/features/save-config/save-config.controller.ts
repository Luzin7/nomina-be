import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { BudgetPresenter } from '@modules/budget/presenters/Budget.presenter';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  SaveBudgetConfigPipe,
  type SaveBudgetConfigRequest,
} from './save-config.dto';
import { SaveBudgetConfigService } from './save-config.handler';

@ApiTags('Budget')
@Controller('budget')
@UseGuards(RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class SaveBudgetConfigController {
  constructor(private readonly service: SaveBudgetConfigService) {}

  @Post('config')
  @HttpCode(statusCode.CREATED)
  @ApiBody({
    description:
      'Cria ou substitui o orçamento de um mês. `effectiveFrom` aceita o mês atual ou o próximo.',
    examples: {
      nextMonth: {
        summary: 'Aplicar no próximo mês',
        value: {
          monthlyIncome: 500000,
          allocations: [
            {
              categoryId: '00000000-0000-0000-0000-000000000000',
              groupName: 'Custos fixos',
              groupOrder: 0,
              categoryOrder: 0,
              percentageOfIncome: 60,
            },
            {
              categoryId: '00000000-0000-0000-0000-000000000001',
              groupName: 'Conforto',
              groupOrder: 1,
              categoryOrder: 0,
              percentageOfIncome: 40,
            },
          ],
        },
      },
    },
  })
  async handle(
    @CurrentLoggedUser() { workspaceId }: TokenPayloadSchema,
    @Body(SaveBudgetConfigPipe) body: SaveBudgetConfigRequest,
  ) {
    const data = await this.service.execute({ ...body, workspaceId });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return BudgetPresenter.toConfig(data.value);
  }
}
