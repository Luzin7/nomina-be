import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { createStructuredCodec } from '@shared/cache/cache-codec';
import { buildCacheKey } from '@shared/cache/cache-key';
import { hashFilters } from '@shared/cache/filter-hash';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { ListTransactionsRequest } from './list-transaction.dto';

type Request = ListTransactionsRequest & TokenPayloadBase;

type Response = {
  transactions: Transaction[];
  total: number;
};

@Injectable()
export class ListTransactionsService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<Error, Response>> {
    const [ledger, category] = await Promise.all([
      readLedgerGeneration(this.cache, request.workspaceId),
      readCategoryGeneration(this.cache, request.workspaceId),
    ]);

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'transaction:list',
        version: 'v1',
        workspaceId: request.workspaceId,
        generations: { ledger, category },
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
          request.page,
          request.pageSize,
        ],
      }),
      ttlSeconds: LEDGER_CACHE_TTL_SECONDS,
      codec: createStructuredCodec<Response>([Transaction]),
      load: () => this.list(request),
    });
  }

  private async list(request: Request): Promise<Either<Error, Response>> {
    const workspaceTimezone = 'America/Sao_Paulo'; // TODO: o ideal é vir do payload do JWT ou Workspace

    const start = request.startDate
      ? this.dateProvider.startOfDay(request.startDate, workspaceTimezone)
      : undefined;

    const end = request.endDate
      ? this.dateProvider.endOfDay(request.endDate, workspaceTimezone)
      : undefined;

    const { transactions, total } =
      await this.transactionRepository.listTransactionsByWorkspaceId({
        workspaceId: request.workspaceId,
        page: request.page,
        pageSize: request.pageSize,
        startDate: start,
        endDate: end,
        type: request.type,
        categoryId: request.categoryId,
        accountId: request.accountId,
        title: request.title,
        status: request.status,
      });

    return right({ transactions, total });
  }
}
