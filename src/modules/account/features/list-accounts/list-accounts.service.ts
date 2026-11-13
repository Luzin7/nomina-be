import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { CACHEABLE_ACCOUNT_CLASSES } from '@modules/account/entities/cacheable-accounts';
import {
  AccountListItem,
  AccountRepository,
} from '@modules/account/repositories/contracts/AccountRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { createStructuredCodec } from '@shared/cache/cache-codec';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { ListAccountsRequest } from './list-accounts.dto';

type Request = ListAccountsRequest & Pick<TokenPayloadSchema, 'workspaceId'>;
type Response = {
  accounts: AccountListItem[];
  total: number;
};

@Injectable()
export class ListAccountsService implements Service<Request, Error, Response> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute({
    page,
    pageSize,
    workspaceId,
  }: Request): Promise<Either<Error, Response>> {
    const generation = await readLedgerGeneration(this.cache, workspaceId);

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'account:list',
        version: 'v1',
        workspaceId,
        generations: { ledger: generation },
        parts: [page, pageSize],
      }),
      ttlSeconds: LEDGER_CACHE_TTL_SECONDS,
      codec: createStructuredCodec<Response>(CACHEABLE_ACCOUNT_CLASSES),
      load: async () => {
        const { accounts, total } =
          await this.accountRepository.findManyByWorkspaceId(
            workspaceId,
            page,
            pageSize,
          );

        return right({ accounts, total });
      },
    });
  }
}
