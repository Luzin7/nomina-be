import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { createStructuredCodec } from '@shared/cache/cache-codec';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { ListRecurringTransactionsRequest } from './list-recurring-transactions.dto';

type Request = ListRecurringTransactionsRequest & TokenPayloadBase;

type Response = {
  recurrings: RecurringTransaction[];
  total: number;
};

@Injectable()
export class ListRecurringTransactionsService implements Service<
  Request,
  never,
  Response
> {
  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute(request: Request): Promise<Either<never, Response>> {
    const { workspaceId, page, pageSize, activeOnly, kind } = request;
    const [ledger, category] = await Promise.all([
      readLedgerGeneration(this.cache, workspaceId),
      readCategoryGeneration(this.cache, workspaceId),
    ]);

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'recurring:list',
        version: 'v1',
        workspaceId,
        generations: { ledger, category },
        parts: [page, pageSize, String(activeOnly), kind],
      }),
      ttlSeconds: LEDGER_CACHE_TTL_SECONDS,
      codec: createStructuredCodec<Response>([RecurringTransaction]),
      load: () => this.list(request),
    });
  }

  private async list({
    workspaceId,
    page,
    pageSize,
    activeOnly,
    kind,
  }: Request): Promise<Either<never, Response>> {
    const { recurrings, total } =
      await this.recurringRepository.findManyByWorkspaceId({
        workspaceId,
        page,
        pageSize,
        isActive: activeOnly,
        kind,
      });

    return right({ recurrings, total });
  }
}
