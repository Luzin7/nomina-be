import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { RecurringSuggestionRepository } from '@modules/transaction/repositories/contracts/RecurringSuggestionRepository';
import {
  billDetectionWindow,
  detectBillSuggestions,
  isBillDetectionDue,
} from '@modules/transaction/valueObjects/BillSuggestionDetection';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Injectable, Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { describeFailure } from './describe-failure';

export type RecurringSuggestionDetectionOutcome =
  | 'persisted'
  | 'unchanged'
  | 'not-due'
  | 'failed';

@Injectable()
export class DetectRecurringSuggestionsService {
  private readonly logger = new Logger(DetectRecurringSuggestionsService.name);

  constructor(
    private readonly suggestionRepository: RecurringSuggestionRepository,
    private readonly timezoneService: GetWorkspaceTimezoneService,
    private readonly dateProvider: DateProvider,
    private readonly cache: CacheProvider,
  ) {}

  async execute(
    workspaceId: string,
    now: Date = this.dateProvider.now(),
  ): Promise<RecurringSuggestionDetectionOutcome> {
    try {
      return await this.detect(workspaceId, now);
    } catch (error) {
      this.logger.error(
        `Failed to detect recurring suggestions for workspace ${workspaceId}: ${describeFailure(error)}`,
      );

      return 'failed';
    }
  }

  private async detect(
    workspaceId: string,
    now: Date,
  ): Promise<RecurringSuggestionDetectionOutcome> {
    const timezone = await this.timezoneService.execute(workspaceId);
    const { lastBillDetectionAt } =
      await this.suggestionRepository.findDetectionState(workspaceId);

    if (!isBillDetectionDue(lastBillDetectionAt, now, timezone)) {
      return 'not-due';
    }

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

    const outcome = await this.suggestionRepository.persistDetection({
      workspaceId,
      timezone,
      now,
      patterns,
    });

    if (outcome !== 'persisted') return outcome;

    await invalidateLedgerReads(
      this.cache,
      workspaceId,
      'detect-recurring-suggestions',
    );

    return 'persisted';
  }
}
