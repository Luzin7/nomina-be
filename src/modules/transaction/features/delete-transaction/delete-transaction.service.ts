import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionNotFoundError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { Service } from '@shared/core/contracts/Service';
import { Either, left, right } from '@shared/core/errors/Either';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { FindTransactionRequest } from '../find-transaction/find-transaction.dto';
import { invalidateMonthReads } from '@shared/cache/report-cache';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';

type Request = FindTransactionRequest & TokenPayloadBase;

@Injectable()
export class DeleteTransactionService implements Service<Request, Error, void> {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly dateProvider: DateProvider,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly redisService: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, void>> {
    const transactionResult = await this.fetchAndValidateTransaction(request);
    if (transactionResult.isLeft()) return left(transactionResult.value);

    const deletionResult =
      await this.transactionRepository.deleteWithBalanceEffect(
        transactionResult.value.id,
        { actorId: request.sub },
      );
    if (deletionResult.isLeft()) return left(deletionResult.value);
    if (!deletionResult.value) return left(new TransactionNotFoundError());

    await invalidateMonthReads(
      this.redisService,
      request.workspaceId,
      [await this.monthOf(transactionResult.value.date, request.workspaceId)],
      'delete-transaction',
    );

    return right(undefined);
  }

  private async monthOf(date: Date, workspaceId: string): Promise<string> {
    const timezone = await this.workspaceTimezone.execute(workspaceId);
    return this.dateProvider.format(date, 'YYYY-MM', timezone);
  }

  private async fetchAndValidateTransaction(
    request: Request,
  ): Promise<Either<Error, Transaction>> {
    const transaction = await this.transactionRepository.findUniqueById(
      request.transactionId,
    );

    if (!transaction) return left(new TransactionNotFoundError());

    if (transaction.workspaceId !== request.workspaceId) {
      return left(
        new UnauthorizedError('Transação não pertence ao workspace.'),
      );
    }

    return right(transaction);
  }
}
