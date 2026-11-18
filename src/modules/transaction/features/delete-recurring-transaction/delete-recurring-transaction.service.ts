import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { AccountNotFoundError } from '@modules/account/errors';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { RecurringTransactionNotFoundError } from '@modules/transaction/errors';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { DeleteRecurringTransactionRequest } from './delete-recurring-transaction.dto';
import { invalidateLedgerReads } from '@shared/cache/report-cache';

type Request = DeleteRecurringTransactionRequest &
  Pick<TokenPayloadBase, 'workspaceId'>;

@Injectable()
export class DeleteRecurringTransactionService implements Service<
  Request,
  Error,
  void
> {
  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
    private readonly accountRepository: AccountRepository,
    private readonly dateProvider: DateProvider,
    private readonly redisService: CacheProvider,
  ) {}

  async execute({
    recurringTransactionId,
    workspaceId,
  }: Request): Promise<Either<Error, void>> {
    const recurring = await this.recurringRepository.findById(
      recurringTransactionId,
    );

    if (!recurring) {
      return left(new RecurringTransactionNotFoundError());
    }

    if (recurring.workspaceId !== workspaceId) {
      return left(new UnauthorizedError());
    }

    const account = await this.accountRepository.findById(recurring.accountId);

    if (!account) {
      return left(new AccountNotFoundError());
    }

    await this.recurringRepository.deleteWithFuturePendingOccurrences(
      recurringTransactionId,
      {
        workspaceId,
        timezone: account.timezone,
        todayStart: this.dateProvider.startOfDay(
          this.dateProvider.now(),
          account.timezone,
        ),
      },
    );

    await invalidateLedgerReads(
      this.redisService,
      workspaceId,
      'delete-recurring-transaction',
    );

    return right(undefined);
  }
}
