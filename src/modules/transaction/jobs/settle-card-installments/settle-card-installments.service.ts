import { BalanceMovementCause, TransactionStatus } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Transaction } from '@modules/transaction/entities/Transaction';
import {
  CardInstallmentSettlementFailedError,
  TransactionAlreadyCompletedError,
  TransactionStatusChangedConcurrentlyError,
} from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Injectable, Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { captureException } from '@sentry/nestjs';
import { getErrorDetails } from '@shared/utils/error-details';

const BATCH_SIZE = 500;
const TIME_BUDGET_MS = 30_000;
const FAILURE_SAMPLE_SIZE = 5;
const SYSTEM_ACTOR_ID = 'system:settle-card-installments';

export type SettleCardInstallmentsOutcome =
  | 'nothing-due'
  | 'success'
  | 'partial-failure'
  | 'total-failure';

export interface SettleCardInstallmentsSummary {
  outcome: SettleCardInstallmentsOutcome;
  settledCount: number;
  skippedCount: number;
  failedCount: number;
  processedCount: number;
  remainingCount: number;
}

type ItemResult = 'settled' | 'skipped' | 'failed';

interface SettlementFailure {
  transactionId: string;
  reason: string;
}

const isAlreadySettledByAnotherRun = (error: Error): boolean =>
  error instanceof TransactionAlreadyCompletedError ||
  error instanceof TransactionStatusChangedConcurrentlyError;

function classifyOutcome(
  summary: Omit<SettleCardInstallmentsSummary, 'outcome'>,
): SettleCardInstallmentsOutcome {
  if (summary.processedCount === 0) return 'nothing-due';
  if (summary.failedCount === 0) return 'success';
  if (summary.failedCount === summary.processedCount) return 'total-failure';
  return 'partial-failure';
}

@Injectable()
export class SettleCardInstallmentsJobService {
  private readonly logger = new Logger(SettleCardInstallmentsJobService.name);

  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly cache: CacheProvider,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(): Promise<SettleCardInstallmentsSummary> {
    const startedAt = this.dateProvider.now();
    const { transactions: due, totalDue } =
      await this.transactionRepository.findDueCardTransactions(
        startedAt,
        BATCH_SIZE,
      );

    const counts = { settled: 0, skipped: 0, failed: 0 };
    const failures: SettlementFailure[] = [];
    const settledWorkspaceIds = new Set<string>();
    let processedCount = 0;

    for (const transaction of due) {
      if (processedCount > 0 && this.isOverBudget(startedAt)) break;

      const result = await this.settle(transaction, failures);
      processedCount += 1;
      counts[result] += 1;
      if (result === 'settled')
        settledWorkspaceIds.add(transaction.workspaceId);
    }

    await this.invalidateReports(settledWorkspaceIds);
    this.reportFailures(failures, counts.failed, processedCount);

    const remainingCount = totalDue - processedCount;
    if (remainingCount > 0) {
      this.logger.warn(
        `Settlement stopped with ${remainingCount} card transaction(s) left for the next run.`,
      );
    }

    const summary = {
      settledCount: counts.settled,
      skippedCount: counts.skipped,
      failedCount: counts.failed,
      processedCount,
      remainingCount,
    };

    return { outcome: classifyOutcome(summary), ...summary };
  }

  private isOverBudget(startedAt: Date): boolean {
    return (
      this.dateProvider.now().getTime() - startedAt.getTime() >= TIME_BUDGET_MS
    );
  }

  private async settle(
    transaction: Transaction,
    failures: SettlementFailure[],
  ): Promise<ItemResult> {
    try {
      const updated =
        await this.transactionRepository.updateStatusWithBalanceEffect(
          {
            transactionId: transaction.id,
            workspaceId: transaction.workspaceId,
            status: TransactionStatus.COMPLETED,
            scheduledSettlement: true,
          },
          {
            actorId: SYSTEM_ACTOR_ID,
            cause: BalanceMovementCause.STATUS_CHANGED,
          },
        );

      if (updated.isRight()) return 'settled';
      if (isAlreadySettledByAnotherRun(updated.value)) return 'skipped';

      this.recordFailure(failures, transaction.id, updated.value);
      return 'failed';
    } catch (error: unknown) {
      this.recordFailure(failures, transaction.id, error);
      return 'failed';
    }
  }

  private async invalidateReports(workspaceIds: Set<string>): Promise<void> {
    for (const workspaceId of workspaceIds) {
      await this.cache
        .delByPattern(`report:*:${workspaceId}:*`)
        .catch((error: unknown) => captureException(error));
    }
  }

  private recordFailure(
    failures: SettlementFailure[],
    transactionId: string,
    error: unknown,
  ): void {
    const { sqlState, messageChain } = getErrorDetails(error);

    this.logger.warn(
      `Failed to settle card transaction ${transactionId} (sqlState=${sqlState ?? 'none'}): ${messageChain}`,
    );
    failures.push({ transactionId, reason: sqlState ?? messageChain });
  }

  private reportFailures(
    failures: SettlementFailure[],
    failedCount: number,
    processedCount: number,
  ): void {
    if (failedCount === 0) return;

    captureException(
      new CardInstallmentSettlementFailedError(failedCount, processedCount),
      {
        extra: {
          failedCount,
          processedCount,
          sample: failures.slice(0, FAILURE_SAMPLE_SIZE),
        },
      },
    );
  }
}
