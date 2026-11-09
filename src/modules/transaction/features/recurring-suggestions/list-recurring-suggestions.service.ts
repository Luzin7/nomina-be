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
  ) {}

  async execute({ workspaceId }: Request): Promise<Either<never, Response>> {
    const now = this.dateProvider.now();

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
