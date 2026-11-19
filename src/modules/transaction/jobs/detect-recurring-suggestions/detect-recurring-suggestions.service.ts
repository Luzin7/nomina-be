import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DetectRecurringSuggestionsService } from '@modules/transaction/features/recurring-suggestions/detect-recurring-suggestions.service';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import { Injectable, Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';

const LOCK_KEY = 'job:recurring-suggestions-detect';
const LOCK_TTL_SECONDS = 300;
const CACHE_OPERATION_TIMEOUT_MS = 2_000;
const READ_STATEMENT_TIMEOUT_MS = 1_000;
const DETECTION_STAGE_TIMEOUT_MS = 5_000;
const WORKSPACE_WORST_CASE_MS =
  CACHE_OPERATION_TIMEOUT_MS * 3 +
  READ_STATEMENT_TIMEOUT_MS * 2 +
  DETECTION_STAGE_TIMEOUT_MS * 2;
const CURL_MAX_TIME_MS = 40_000;
const TRANSPORT_MARGIN_MS = 2_000;
const TIME_BUDGET_MS =
  CURL_MAX_TIME_MS - WORKSPACE_WORST_CASE_MS - TRANSPORT_MARGIN_MS;
const BATCH_SIZE = 100;

export type RecurringSuggestionDetectionJobOutcome =
  | 'nothing-due'
  | 'success'
  | 'partial-failure'
  | 'total-failure';

export interface RecurringSuggestionDetectionJobSummary {
  outcome: RecurringSuggestionDetectionJobOutcome;
  scanned: number;
  persisted: number;
  unchanged: number;
  notDue: number;
  failed: number;
  failedWorkspaceIds: string[];
  truncated: boolean;
  lastCursor: string | null;
  skipped: boolean;
}

type Tally = Pick<RecurringSuggestionDetectionJobSummary, 'scanned'> & {
  persisted: number;
  unchanged: number;
  notDue: number;
  failed: number;
  failedWorkspaceIds: string[];
};

type RunFlags = Pick<
  RecurringSuggestionDetectionJobSummary,
  'truncated' | 'skipped'
>;

const newTally = (): Tally => ({
  scanned: 0,
  persisted: 0,
  unchanged: 0,
  notDue: 0,
  failed: 0,
  failedWorkspaceIds: [],
});

const classifyOutcome = (
  tally: Tally,
): RecurringSuggestionDetectionJobOutcome => {
  if (tally.scanned === 0) return 'nothing-due';
  if (tally.failed === 0) return 'success';
  if (tally.failed === tally.scanned) return 'total-failure';
  return 'partial-failure';
};

@Injectable()
export class DetectRecurringSuggestionsJobService {
  private readonly logger = new Logger(
    DetectRecurringSuggestionsJobService.name,
  );

  constructor(
    private readonly suggestionRepository: RecurringSuggestionRepository,
    private readonly detection: DetectRecurringSuggestionsService,
    private readonly cache: CacheProvider,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(): Promise<RecurringSuggestionDetectionJobSummary> {
    const lock = await this.cache.acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
    if (!lock) {
      this.logger.warn(
        `${DetectRecurringSuggestionsJobService.name} skipped: lock busy, another run holds ${LOCK_KEY}`,
      );

      return this.summaryOf(newTally(), null, {
        truncated: false,
        skipped: true,
      });
    }

    try {
      return await this.run();
    } finally {
      await this.cache.releaseLock(lock);
    }
  }

  private async run(): Promise<RecurringSuggestionDetectionJobSummary> {
    const startedAt = this.dateProvider.now();
    const deadline = startedAt.getTime() + TIME_BUDGET_MS;
    const tally = newTally();
    let cursor: string | null = null;
    let truncated = false;

    while (!truncated) {
      const batch = await this.suggestionRepository.findDueWorkspaceBatch(
        cursor,
        BATCH_SIZE,
        startedAt,
      );
      if (batch.length === 0) break;

      for (const workspaceId of batch) {
        if (!this.fitsOneWorkspace(deadline)) {
          truncated = true;
          break;
        }

        cursor = workspaceId;
        await this.detectWorkspace(workspaceId, startedAt, tally);
      }
    }

    if (truncated) {
      this.logger.warn(
        `${DetectRecurringSuggestionsJobService.name} truncated: true cursor=${cursor ?? 'none'} scanned=${tally.scanned}`,
      );
    }

    return this.summaryOf(tally, cursor, { truncated, skipped: false });
  }

  private async detectWorkspace(
    workspaceId: string,
    now: Date,
    tally: Tally,
  ): Promise<void> {
    tally.scanned += 1;
    const outcome = await this.detection.execute(workspaceId, now);

    if (outcome === 'persisted') tally.persisted += 1;
    if (outcome === 'unchanged') tally.unchanged += 1;
    if (outcome === 'not-due') tally.notDue += 1;
    if (outcome === 'failed') {
      tally.failed += 1;
      tally.failedWorkspaceIds.push(workspaceId);
    }
  }

  private fitsOneWorkspace(deadline: number): boolean {
    return (
      this.dateProvider.now().getTime() + WORKSPACE_WORST_CASE_MS <= deadline
    );
  }

  private summaryOf(
    tally: Tally,
    lastCursor: string | null,
    flags: RunFlags,
  ): RecurringSuggestionDetectionJobSummary {
    return {
      outcome: classifyOutcome(tally),
      ...tally,
      ...flags,
      lastCursor,
    };
  }
}
