import { AccountType } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CreditCard } from '@modules/account/entities/CreditCardAccount';
import { AnyAccount } from '@modules/account/entities/types';
import {
  AccountNotFoundError,
  AutopayInvalidSourceAccountError,
  AutopayRequiresCreditCardError,
} from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { SetAutopayRequest } from './set-autopay.dto';

type Request = SetAutopayRequest & { accountId: string } & Pick<
    TokenPayloadSchema,
    'workspaceId'
  >;

const VALID_SOURCE_TYPES: string[] = [AccountType.CHECKING, AccountType.CASH];

@Injectable()
export class SetAutopayService implements Service<Request, Error, CreditCard> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  private isValidSource(
    source: AnyAccount | null,
    card: CreditCard,
  ): source is AnyAccount {
    if (!source) return false;
    if (source.id === card.id) return false;
    if (source.workspaceId !== card.workspaceId) return false;
    return VALID_SOURCE_TYPES.includes(source.type);
  }

  async execute({
    accountId,
    workspaceId,
    enabled,
    sourceAccountId,
  }: Request): Promise<Either<Error, CreditCard>> {
    const card = await this.accountRepository.findById(accountId);

    if (card?.workspaceId !== workspaceId) {
      return left(new AccountNotFoundError());
    }

    if (!(card instanceof CreditCard)) {
      return left(new AutopayRequiresCreditCardError());
    }

    if (!enabled) {
      card.disableAutoPay();
      await this.accountRepository.updateAutoPay(card);
      await invalidateLedgerReads(this.cache, workspaceId, 'set-autopay');
      return right(card);
    }

    const resolvedSourceId = sourceAccountId ?? card.autoPaySourceAccountId;

    if (resolvedSourceId) {
      const source = await this.accountRepository.findById(resolvedSourceId);
      if (!this.isValidSource(source, card)) {
        return left(
          new AutopayInvalidSourceAccountError(
            'use uma conta corrente ou carteira do mesmo workspace.',
          ),
        );
      }
    }

    const enableResult = card.enableAutoPay(
      resolvedSourceId ?? null,
      this.dateProvider.now(),
    );
    if (enableResult.isLeft()) return left(enableResult.value);

    await this.accountRepository.updateAutoPay(card);
    await invalidateLedgerReads(this.cache, workspaceId, 'set-autopay');

    return right(card);
  }
}
