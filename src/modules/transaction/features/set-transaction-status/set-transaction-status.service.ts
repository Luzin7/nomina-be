import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { SetTransactionStatusRequest } from './set-transaction-status.dto';
import { invalidateMonthReads } from '@shared/cache/report-cache';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { RecurringSuggestionDetectionDispatcher } from '../recurring-suggestions/recurring-suggestion-detection.dispatcher';

type Request = SetTransactionStatusRequest &
  Pick<TokenPayloadBase, 'workspaceId' | 'sub'> & {
    transactionId: string;
  };

@Injectable()
export class SetTransactionStatusService implements Service<
  Request,
  Error,
  Transaction
> {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly dateProvider: DateProvider,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly redisService: CacheProvider,
    private readonly detectionDispatcher: RecurringSuggestionDetectionDispatcher,
  ) {}

  async execute(request: Request): Promise<Either<Error, Transaction>> {
    const updated =
      await this.transactionRepository.updateStatusWithBalanceEffect(
        {
          transactionId: request.transactionId,
          workspaceId: request.workspaceId,
          status: request.status,
        },
        { actorId: request.sub },
      );
    if (updated.isLeft()) return left(updated.value);

    await invalidateMonthReads(
      this.redisService,
      request.workspaceId,
      [await this.monthOf(updated.value.date, request.workspaceId)],
      'set-transaction-status',
    );

    this.detectionDispatcher.notify(request.workspaceId);

    return right(updated.value);
  }

  private async monthOf(date: Date, workspaceId: string): Promise<string> {
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    return this.dateProvider.format(date, 'YYYY-MM', timezone);
  }
}
