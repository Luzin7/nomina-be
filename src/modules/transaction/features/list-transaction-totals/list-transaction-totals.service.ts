import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  TransactionRepository,
  TransactionTotals,
} from '@modules/transaction/repositories/contracts/TransactionRepository';
import { resolveListDayRange } from '@modules/transaction/services/resolve-list-day-range';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { buildCacheKey } from '@shared/cache/cache-key';
import { hashFilters } from '@shared/cache/filter-hash';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_LIVE_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { ListTransactionTotalsRequest } from './list-transaction-totals.dto';

type Request = ListTransactionTotalsRequest & TokenPayloadBase;

@Injectable()
export class ListTransactionTotalsService implements Service<
  Request,
  Error,
  TransactionTotals
> {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly dateProvider: DateProvider,
    private readonly workspaceTimezone: GetWorkspaceTimezoneService,
    private readonly cache: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, TransactionTotals>> {
    const ledger = await readLedgerGeneration(this.cache, request.workspaceId);

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'transaction:list-totals',
        version: 'v1',
        workspaceId: request.workspaceId,
        generations: { ledger },
        parts: [
          hashFilters({
            startDate: request.startDate,
            endDate: request.endDate,
            type: request.type,
            categoryId: request.categoryId,
            accountId: request.accountId,
            title: request.title,
            status: request.status,
          }),
        ],
      }),
      ttlSeconds: LEDGER_LIVE_CACHE_TTL_SECONDS,
      load: () => this.sum(request),
    });
  }

  private async sum(
    request: Request,
  ): Promise<Either<Error, TransactionTotals>> {
    const timezone = await this.workspaceTimezone.execute(request.workspaceId);

    const totals =
      await this.transactionRepository.sumTransactionsByWorkspaceId({
        workspaceId: request.workspaceId,
        ...resolveListDayRange(this.dateProvider, {
          startDate: request.startDate,
          endDate: request.endDate,
          timezone,
        }),
        type: request.type,
        categoryId: request.categoryId,
        accountId: request.accountId,
        title: request.title,
        status: request.status,
      });

    return right(totals);
  }
}
