import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RecurringSuggestion } from '@modules/transaction/entities/RecurringSuggestion';
import {
  RecurringSuggestionRepository,
  RecurringSuggestionView,
} from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import {
  billDetectionWindow,
  detectBillSuggestions,
  isBillDetectionDue,
} from '@modules/transaction/valueObjects/BillSuggestionDetection';
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
    const localDay = await this.resolveLocalDay(workspaceId, now);

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
      load: () => this.list(workspaceId, now),
    });
  }

  private async resolveLocalDay(
    workspaceId: string,
    now: Date,
  ): Promise<string | null> {
    try {
      const timezone = await this.timezoneService.execute(workspaceId);
      return this.dateProvider.format(now, 'YYYY-MM-DD', timezone);
    } catch {
      return null;
    }
  }

  private async list(
    workspaceId: string,
    now: Date,
  ): Promise<Either<never, Response>> {
    try {
      await this.detectIfDue(workspaceId, now);
    } catch {
      this.logger.error(
        `Failed to detect recurring suggestions for workspace ${workspaceId}`,
      );
    }

    const suggestions =
      await this.suggestionRepository.findPendingByWorkspace(workspaceId);

    return right({ suggestions });
  }

  private async detectIfDue(workspaceId: string, now: Date): Promise<void> {
    const timezone = await this.timezoneService.execute(workspaceId);
    const { lastBillDetectionAt } =
      await this.suggestionRepository.findDetectionState(workspaceId);

    if (!isBillDetectionDue(lastBillDetectionAt, now, timezone)) return;

    const window = billDetectionWindow(now, timezone, this.dateProvider);
    const [transactions, activeRules] = await Promise.all([
      this.suggestionRepository.findBillCandidates({
        workspaceId,
        timezone,
        from: window.from,
        to: window.to,
      }),
      this.suggestionRepository.findActiveExpenseRules(workspaceId),
    ]);

    const patterns = detectBillSuggestions({
      months: window.months,
      transactions,
      activeRules,
    });

    await this.suggestionRepository.persistDetection({
      workspaceId,
      timezone,
      now,
      patterns,
    });
  }
}
