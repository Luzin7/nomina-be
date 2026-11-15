import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import {
  AccountNotFoundError,
  AccountTypeError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import {
  CardCyclePeriodRecord,
  CardCycleRepository,
} from '@modules/card-cycle/repositories/contracts/CardCycleRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { GetCardCyclePeriodsRequest } from './get-card-cycle-periods.dto';

type Request = GetCardCyclePeriodsRequest &
  Pick<TokenPayloadSchema, 'workspaceId'> & { accountId: string };

@Injectable()
export class GetCardCyclePeriodsService implements Service<
  Request,
  Error,
  CardCyclePeriodRecord[]
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly cardCycleRepository: CardCycleRepository,
  ) {}

  async execute(
    request: Request,
  ): Promise<Either<Error, CardCyclePeriodRecord[]>> {
    const account = await this.accountRepository.findById(request.accountId);

    if (!account) return left(new AccountNotFoundError());

    if (account.workspaceId !== request.workspaceId)
      return left(new UnauthorizedError());

    if (!(account instanceof CreditCard)) return left(new AccountTypeError());

    const periods = await this.cardCycleRepository.listPeriods(
      request.workspaceId,
      account.id,
      request.limit,
    );

    return right(periods);
  }
}
