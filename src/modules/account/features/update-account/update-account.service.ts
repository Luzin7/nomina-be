import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AnyAccount } from '@modules/account/entities/types';
import { ConflictAccountError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { UpdateAccountRequest } from './update-account.dto';

type Request = UpdateAccountRequest & { accountId: string } & Pick<
    TokenPayloadSchema,
    'workspaceId'
  >;

@Injectable()
export class UpdateAccountService implements Service<
  Request,
  Error,
  AnyAccount
> {
  constructor(private readonly accountRepository: AccountRepository) {}

  private validateCreditCardFields(
    account: CreditCard,
    closingDaysBeforeDue?: number | null,
    dueDay?: number | null,
    creditLimit?: number,
  ): Either<Error, void> {
    if (
      closingDaysBeforeDue !== undefined &&
      closingDaysBeforeDue !== null &&
      dueDay !== undefined &&
      dueDay !== null
    ) {
      const dateResult = account.updateInvoiceDates(
        closingDaysBeforeDue,
        dueDay,
      );
      if (dateResult.isLeft()) return left(dateResult.value);
    }

    if (creditLimit !== undefined && creditLimit !== null) {
      const limitInCents = BigInt(creditLimit);
      const limitResult = account.adjustLimit(limitInCents);
      if (limitResult.isLeft()) return left(limitResult.value);
    }

    return right(undefined);
  }

  async execute({
    accountId,
    name,
    workspaceId,
    closingDaysBeforeDue,
    dueDay,
    creditLimit,
  }: Request): Promise<Either<Error, AnyAccount>> {
    const account = await this.accountRepository.findById(accountId);

    if (account?.workspaceId !== workspaceId) {
      return left(new UnauthorizedError());
    }

    if (name && account.name !== name) {
      const nameAccountAlreadyExists =
        await this.accountRepository.findByNameAndWorkspaceId(
          name,
          workspaceId,
        );

      if (
        nameAccountAlreadyExists &&
        nameAccountAlreadyExists.id !== accountId
      ) {
        return left(
          new ConflictAccountError(
            'Já existe uma conta com esse nome neste workspace.',
          ),
        );
      }

      account.updateName(name);
    }

    if (account instanceof CreditCard) {
      const creditCardResult = this.validateCreditCardFields(
        account,
        closingDaysBeforeDue,
        dueDay,
        creditLimit,
      );
      if (creditCardResult.isLeft()) return left(creditCardResult.value);
    }

    await this.accountRepository.update(account);

    return right(account);
  }
}
