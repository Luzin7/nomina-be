import { UserRole } from '@constants/enums';
import { ErrorPresenter } from '@infra/presenters/ErrorPresenter';
import { AccountPresenter } from '@modules/account/presenters/Account.presenter';
import { CheckLimit } from '@modules/subscription/decorators/CheckLimit.decorator';
import { SubscriptionLimitsGuard } from '@modules/subscription/guards/SubscriptionLimits.guard';
import { ResourceType } from '@modules/subscription/services/CheckSubscriptionLimits.service';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { CurrentLoggedUser } from '@providers/auth/decorators/CurrentLoggedUser.decorator';
import { Roles } from '@providers/auth/decorators/Roles.decorator';
import { RolesGuard } from '@providers/auth/guards/Roles.guard';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { statusCode } from '@shared/core/types/statusCode';
import {
  CreateAccountPipe,
  type CreateAccountRequest,
} from './create-account.dto';
import { CreateAccountService } from './create-account.service';

@ApiTags('Account')
@Controller('account')
@UseGuards(RolesGuard)
@UseGuards(SubscriptionLimitsGuard)
@CheckLimit(ResourceType.ACCOUNT)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class CreateAccountController {
  constructor(private readonly service: CreateAccountService) {}

  @Post('create')
  @HttpCode(statusCode.CREATED)
  @ApiBody({
    description: 'Criar uma conta. O campo `type` define os campos aceitos.',
    examples: {
      checking: {
        summary: 'Conta corrente',
        value: {
          type: 'CHECKING',
          name: 'Nubank',
          balance: 0,
          timezone: 'America/Sao_Paulo',
        },
      },
      credit_card: {
        summary: 'Cartão de crédito',
        value: {
          type: 'CREDIT_CARD',
          name: 'Itaú Visa',
          creditLimit: 500000,
          closingDaysBeforeDue: 10,
          dueDay: 20,
          timezone: 'America/Sao_Paulo',
        },
        description:
          '`closingDaysBeforeDue` é a distância em dias entre o fechamento e o vencimento — aceita apenas 5, 7 ou 10. `dueDay` vai de 1 a 28. `creditLimit` é opcional (null = sem limite).',
      },
    },
  })
  async handle(
    @CurrentLoggedUser() { workspaceId, sub }: TokenPayloadSchema,
    @Body(CreateAccountPipe) body: CreateAccountRequest,
  ) {
    const data = await this.service.execute({
      ...body,
      workspaceId,
      sub,
    });

    if (data.isLeft()) {
      return ErrorPresenter.toHTTP(data.value);
    }

    return {
      data: AccountPresenter.toHTTP(data.value),
    };
  }
}
