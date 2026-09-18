import { AccountType } from '@constants/enums';
import { CheckingAccount } from '@modules/account/entities/CheckingAccount';
import { AnyAccount } from '@modules/account/entities/types';

import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';

import { CashAccount } from '@modules/account/entities/CashAccounts';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { InvestmentAccount } from '@modules/account/entities/InvestmentAccount';
import { ConflictAccountError } from '@modules/account/errors';
import { UserNotFoundError } from '@modules/user/errors';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { CreateAccountRequest } from './create-account.dto';

type Request = CreateAccountRequest & TokenPayloadBase;

@Injectable()
export class CreateAccountService implements Service<
  Request,
  Error,
  AnyAccount
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly userRepository: UserRepository,
    private readonly redisService: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, AnyAccount>> {
    const { sub, workspaceId, name, timezone } = request;

    const user = await this.userRepository.findUniqueById(sub);
    if (!user) {
      return left(new UserNotFoundError());
    }

    const nameAccountAlreadyExists =
      await this.accountRepository.findByNameAndWorkspaceId(name, workspaceId);
    if (nameAccountAlreadyExists) {
      return left(
        new ConflictAccountError(
          'Já existe uma conta com este nome no workspace.',
        ),
      );
    }

    let accountOrError: Either<Error, AnyAccount>;

    switch (request.type) {
      case AccountType.CREDIT_CARD: {
        const creditLimit =
          request.creditLimit == null ? null : BigInt(request.creditLimit);

        accountOrError = CreditCard.create({
          workspaceId,
          name: request.name,
          creditLimit,
          closingDaysBeforeDue: request.closingDaysBeforeDue,
          dueDay: request.dueDay,
          timezone,
        });
        break;
      }

      case AccountType.CHECKING:
        accountOrError = CheckingAccount.create({
          workspaceId,
          name: request.name,
          type: AccountType.CHECKING,
          balance: BigInt(request.balance ?? 0),
          timezone,
        });
        break;

      case AccountType.CASH:
        accountOrError = CashAccount.create({
          workspaceId,
          name: request.name,
          balance: BigInt(request.balance ?? 0),
          timezone,
        });
        break;

      case AccountType.INVESTMENT:
        accountOrError = InvestmentAccount.create({
          workspaceId,
          name: request.name,
          balance: BigInt(request.balance ?? 0),
          timezone,
        });
        break;

      default:
        return left(new Error(`Tipo de conta não suportado: ${request}`));
    }

    if (accountOrError.isLeft()) {
      return left(accountOrError.value);
    }

    const account = await this.accountRepository.create(accountOrError.value);

    await this.redisService.delByPattern(
      `report:month-summary:${workspaceId}:*`,
    );

    return right(account);
  }
}
