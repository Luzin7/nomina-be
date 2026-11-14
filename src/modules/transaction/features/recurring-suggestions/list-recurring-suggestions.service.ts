import { readCategoryGeneration } from '@modules/category/services/category-list-cache';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { WorkspaceTimezoneUnavailableError } from '@modules/transaction/errors';
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
import { DomainError } from '@shared/core/errors/DomainError';
import { Either, right } from '@shared/core/errors/Either';

const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return 'UnknownError';
  if (error instanceof DomainError) return `${error.name}: ${error.message}`;
  return error.constructor.name;
};

const describeFailure = (error: unknown): string => {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!cause) return describeError(error);
  return `${describeError(error)} (cause: ${describeError(cause)})`;
};

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
      load: () => this.list(workspaceId, timezone, now),
    });
  }

  private async resolveTimezone(workspaceId: string): Promise<string | null> {
    try {
      return await this.timezoneService.execute(workspaceId);
    } catch {
      return null;
    }
  }

  private async list(
    workspaceId: string,
    timezone: string | null,
    now: Date,
  ): Promise<Either<never, Response>> {
    try {
      await this.detectIfDue(workspaceId, timezone, now);
    } catch (error) {
      this.logger.error(
        `Failed to detect recurring suggestions for workspace ${workspaceId}: ${describeFailure(error)}`,
      );
    }

    const suggestions =
      await this.suggestionRepository.findPendingByWorkspace(workspaceId);

    return right({ suggestions });
  }

  private async detectIfDue(
    workspaceId: string,
    timezone: string | null,
    now: Date,
  ): Promise<void> {
    if (timezone === null) throw new WorkspaceTimezoneUnavailableError();

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
