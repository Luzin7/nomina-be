import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RecurringSuggestion } from '@modules/transaction/entities/RecurringSuggestion';
import {
  RecurringSuggestionRepository,
  RecurringSuggestionView,
} from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable, Logger } from '@nestjs/common';
import { TokenPayloadBase } from '@providers/auth/strategys/jwtStrategy';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { createStructuredCodec } from '@shared/cache/cache-codec';
import { buildCacheKey } from '@shared/cache/cache-key';
import { readThrough } from '@shared/cache/read-through';
import {
  LEDGER_CACHE_TTL_SECONDS,
  readLedgerGeneration,
} from '@shared/cache/report-cache';
import { Service } from '@shared/core/contracts/Service';
import { Either, right } from '@shared/core/errors/Either';
import { describeFailure } from './describe-failure';

type Request = Pick<TokenPayloadBase, 'workspaceId'>;

type Response = { suggestions: RecurringSuggestionView[] };

@Injectable()
export class ListRecurringSuggestionsService implements Service<
  Request,
  never,
  Response
> {
  private readonly logger = new Logger(ListRecurringSuggestionsService.name);

  constructor(
    private readonly suggestionRepository: RecurringSuggestionRepository,
    private readonly timezoneService: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute({ workspaceId }: Request): Promise<Either<never, Response>> {
    const [ledger, category] = await Promise.all([
      readLedgerGeneration(this.cache, workspaceId),
      readCategoryGeneration(this.cache, workspaceId),
    ]);
    const now = this.dateProvider.now();
    const timezone = await this.resolveTimezone(workspaceId);
    const localDay =
      timezone === null
        ? null
        : this.dateProvider.format(now, 'YYYY-MM-DD', timezone);

    return readThrough({
      cache: this.cache,
      key:
        localDay === null
          ? null
          : buildCacheKey({
              route: 'suggestion:list',
              version: 'v2',
              workspaceId,
              generations: { ledger, category },
              parts: [localDay],
            }),
      ttlSeconds: LEDGER_CACHE_TTL_SECONDS,
      codec: createStructuredCodec<Response>([RecurringSuggestion]),
      load: () => this.list(workspaceId),
    });
  }

  private async resolveTimezone(workspaceId: string): Promise<string | null> {
    try {
      return await this.timezoneService.execute(workspaceId);
    } catch (error) {
      this.logger.warn(
        `Timezone unavailable for workspace ${workspaceId}: ${describeFailure(error)}`,
      );

      return null;
    }
  }

  private async list(workspaceId: string): Promise<Either<never, Response>> {
    const suggestions =
      await this.suggestionRepository.findPendingByWorkspace(workspaceId);

    return right({ suggestions });
  }
}
