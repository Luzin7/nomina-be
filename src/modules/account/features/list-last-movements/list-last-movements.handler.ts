import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import {
  AccountLastMovement,
  AccountRepository,
} from '@modules/account/repositories/contracts/AccountRepository';
import { Injectable } from '@nestjs/common';
import { TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';

type Request = Pick<TokenPayloadSchema, 'workspaceId'>;
type Response = { movements: AccountLastMovement[] };

@Injectable()
export class ListLastMovementsService implements Service<
  Request,
  Error,
  Response
> {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute({ workspaceId }: Request): Promise<Either<Error, Response>> {
    const generation = await readLedgerGeneration(this.cache, workspaceId);

    return readThrough({
      cache: this.cache,
      key: buildCacheKey({
        route: 'account:last-movements',
        version: 'v2',
        workspaceId,
        generations: { ledger: generation },
      }),
      ttlSeconds: LEDGER_CACHE_TTL_SECONDS,
      load: async () => {
        const movements =
          await this.accountRepository.findLastMovementsByWorkspaceId(
            workspaceId,
          );

        return right({ movements });
      },
    });
  }
}
