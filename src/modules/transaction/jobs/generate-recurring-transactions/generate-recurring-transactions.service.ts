import { RecurrenceFrequency, TransactionStatus } from '@constants/enums';
import {
  CacheProvider,
  LockHandle,
} from '@infra/cache/contracts/CacheProvider';
import { RecurringTransaction } from '@modules/transaction/entities/RecurringTransaction';
import { Transaction } from '@modules/transaction/entities/Transaction';
import {
  RecurringGenerationFailedError,
  UnknownRecurrenceFrequencyError,
} from '@modules/transaction/errors';
import {
  CreateGeneratedTransactionsResult,
  RecurringRuleSchedule,
  RecurringTransactionRepository,
} from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { NextGenerationDateCalculator } from '@modules/transaction/services/contracts/NextGenerationDateCalculator';
import { Injectable, Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { captureException } from '@sentry/nestjs';
import { invalidateLedgerReads } from '@shared/cache/report-cache';
import { Either, left, right } from '@shared/core/errors/Either';
import { getErrorDetails } from '@shared/utils/error-details';
import { isPlanExhaustedBefore } from '@utils/installmentSchedule';

const BATCH_SIZE = 50;
const LOCK_TTL_SECONDS = 300;
const CACHE_TTL_SECONDS = 86400;
const LOOK_AHEAD_DAYS = 7;
const RUN_CLOCK_TIMEZONE = 'UTC';
const FOREIGN_KEY_VIOLATION = '23503';
const RECURRING_RULE_FK =
  /transactions_recurring_transaction_id_(recurring_transactions_id|fkey)/;

function isMissingRecurringRuleViolation(error: unknown): boolean {
  const { sqlState, messageChain } = getErrorDetails(error);

  return (
    sqlState === FOREIGN_KEY_VIOLATION && RECURRING_RULE_FK.test(messageChain)
  );
}

function getMaxGenerations(frequency: RecurrenceFrequency): number {
  switch (frequency) {
    case RecurrenceFrequency.WEEKLY:
      return 104;
    case RecurrenceFrequency.MONTHLY:
      return 24;
    case RecurrenceFrequency.YEARLY:
      return 10;
    default:
      throw new UnknownRecurrenceFrequencyError(String(frequency));
  }
}

export type RecurringGenerationOutcome =
  | 'skipped-already-processed'
  | 'skipped-lock-held'
  | 'nothing-due'
  | 'success'
  | 'partial-failure'
  | 'total-failure';

export interface GenerateRecurringTransactionsSummary {
  outcome: RecurringGenerationOutcome;
  generatedCount: number;
  skippedCount: number;
  failedCount: number;
  processedCount: number;
}

interface GenerationCounters {
  generatedCount: number;
  skippedCount: number;
  failedCount: number;
  processedCount: number;
}

interface RecurrenceOutcome {
  generatedCount: number;
  skipped: boolean;
  failed: boolean;
  persisted: boolean;
}

type GeneratedWriteResult =
  | CreateGeneratedTransactionsResult
  | { outcome: 'skipped-rule-gone' };

function skippedSummary(
  outcome: Extract<
    RecurringGenerationOutcome,
    'skipped-already-processed' | 'skipped-lock-held'
  >,
): GenerateRecurringTransactionsSummary {
  return {
    outcome,
    generatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    processedCount: 0,
  };
}

function classifyOutcome(
  counters: GenerationCounters,
): RecurringGenerationOutcome {
  if (counters.processedCount === 0) return 'nothing-due';
  if (counters.failedCount === 0) return 'success';
  if (counters.failedCount === counters.processedCount) return 'total-failure';

  return 'partial-failure';
}

@Injectable()
export class GenerateRecurringTransactionsJobService {
  private readonly logger = new Logger(
    GenerateRecurringTransactionsJobService.name,
  );

  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
    private readonly calculateNextDateService: NextGenerationDateCalculator,
    private readonly redis: CacheProvider,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(): Promise<
    Either<Error, GenerateRecurringTransactionsSummary>
  > {
    let lock: LockHandle | null = null;

    try {
      const now = this.dateProvider.now();
      const day = this.dateProvider.format(
        now,
        'YYYY-MM-DD',
        RUN_CLOCK_TIMEZONE,
      );

      const cacheKey = `processed:recurring:${day}`;
      const lockKey = `lock:recurring:${day}`;

      if (!this.redis.isEnabled) {
        this.logger.warn(
          'Redis is disabled. Generating recurring transactions without a distributed lock.',
        );
      }

      if (await this.redis.exists(cacheKey)) {
        this.logger.log(
          'Recurring generation skipped: the day is already marked as processed in redis.',
        );
        return right(skippedSummary('skipped-already-processed'));
      }

      lock = await this.redis.acquireLock(lockKey, LOCK_TTL_SECONDS);
      if (!lock) {
        this.logger.warn(
          'Recurring generation skipped: another run holds the lock.',
        );
        return right(skippedSummary('skipped-lock-held'));
      }

      const lookAheadDate = this.dateProvider.add(
        now,
        LOOK_AHEAD_DAYS,
        'day',
        RUN_CLOCK_TIMEZONE,
      );

      const counters = await this.generateAll(lookAheadDate);

      await this.redis.set(cacheKey, '1', CACHE_TTL_SECONDS);

      return right({ ...counters, outcome: classifyOutcome(counters) });
    } catch (error: unknown) {
      const err =
        error instanceof Error
          ? error
          : new Error(String(error ?? 'Unknown error'));

      captureException(err);

      return left(new RecurringGenerationFailedError(err.message));
    } finally {
      if (lock) {
        await this.redis.releaseLock(lock).catch((e) => captureException(e));
      }
    }
  }

  private async generateAll(lookAheadDate: Date): Promise<GenerationCounters> {
    const counters: GenerationCounters = {
      generatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      processedCount: 0,
    };
    const persistedWorkspaceIds = new Set<string>();
    let afterId: string | null = null;
    let batch: RecurringRuleSchedule[];

    try {
      do {
        batch = await this.recurringRepository.listNeedingGeneration(
          lookAheadDate,
          BATCH_SIZE,
          afterId,
        );

        for (const schedule of batch) {
          counters.processedCount++;

          const outcome = await this.generateForRecurring(
            schedule,
            lookAheadDate,
          );
          counters.generatedCount += outcome.generatedCount;

          if (outcome.skipped) counters.skippedCount++;
          if (outcome.failed) counters.failedCount++;
          if (outcome.persisted) {
            persistedWorkspaceIds.add(schedule.recurring.workspaceId);
          }
        }

        afterId = batch.at(-1)?.recurring.id ?? null;
      } while (batch.length === BATCH_SIZE);
    } finally {
      await this.invalidateReports(persistedWorkspaceIds);
    }

    return counters;
  }

  private async invalidateReports(workspaceIds: Set<string>): Promise<void> {
    for (const workspaceId of workspaceIds) {
      await invalidateLedgerReads(
        this.redis,
        workspaceId,
        'generate-recurring-transactions',
      );
    }
  }

  private async generateForRecurring(
    schedule: RecurringRuleSchedule,
    thresholdDate: Date,
  ): Promise<RecurrenceOutcome> {
    try {
      return await this.generateTransactionsForRecurring(
        schedule,
        thresholdDate,
      );
    } catch (error: unknown) {
      this.reportRecurringFailure(schedule.recurring.id, error);
      return {
        generatedCount: 0,
        skipped: false,
        failed: true,
        persisted: false,
      };
    }
  }

  private reportRecurringFailure(recurringId: string, error: unknown): void {
    captureException(error);

    const { sqlState, messageChain } = getErrorDetails(error);

    this.logger.error(
      `Failed to generate recurring transactions for ${recurringId} (sqlState=${sqlState ?? 'none'}): ${messageChain}`,
    );
  }

  private planIsExhaustedBefore(
    schedule: RecurringRuleSchedule,
    targetDate: Date,
  ): boolean {
    const { recurring, timezone } = schedule;

    return isPlanExhaustedBefore(
      {
        startDate: recurring.startDate,
        frequency: recurring.frequency,
        interval: recurring.interval,
        installmentCount: recurring.installmentCount,
        endDate: recurring.endDate,
        timezone,
      },
      targetDate,
      this.dateProvider,
    );
  }

  private async generateTransactionsForRecurring(
    schedule: RecurringRuleSchedule,
    thresholdDate: Date,
  ): Promise<RecurrenceOutcome> {
    const { recurring, timezone } = schedule;
    const transactionsToCreate: Array<Transaction> = [];
    let failed = false;

    let targetDate = recurring.lastGenerated
      ? this.calculateNextDateService.execute({
          anchorDate: recurring.startDate,
          baseDate: recurring.lastGenerated,
          frequency: recurring.frequency,
          interval: recurring.interval,
          timezone,
        })
      : recurring.startDate;

    let generationCount = 0;

    while (targetDate <= thresholdDate) {
      if (generationCount >= getMaxGenerations(recurring.frequency)) {
        this.logger.warn(
          `Job: limite de segurança atingido para recorrência ${recurring.id}.`,
        );
        break;
      }

      if (this.planIsExhaustedBefore(schedule, targetDate)) {
        this.logger.warn(
          `Job: plano esgotado ${recurring.endDate ? 'pela data final' : 'pela contagem de parcelas'}; recorrência ${recurring.id} (workspace ${recurring.workspaceId}) na última geração ${this.dateProvider.format(recurring.lastGenerated ?? recurring.startDate, 'YYYY-MM-DD', timezone)}, data alvo ${this.dateProvider.format(targetDate, 'YYYY-MM-DD', timezone)}.`,
        );
        recurring.deactivate();
        break;
      }

      const transactionOrError = Transaction.create({
        workspaceId: recurring.workspaceId,
        accountId: recurring.accountId,
        categoryId: recurring.categoryId,
        destinationAccountId: recurring.destinationAccountId,
        title: recurring.title,
        description: recurring.description,
        amount: recurring.amount,
        date: targetDate,
        type: recurring.type,
        status: TransactionStatus.PENDING,
        recurringId: recurring.id,
      });

      if (transactionOrError.isLeft()) {
        this.reportRecurringFailure(recurring.id, transactionOrError.value);
        failed = true;
        break;
      }

      transactionsToCreate.push(transactionOrError.value);

      recurring.markAsGenerated(targetDate);

      targetDate = this.calculateNextDateService.execute({
        anchorDate: recurring.startDate,
        baseDate: targetDate,
        frequency: recurring.frequency,
        interval: recurring.interval,
        timezone,
      });
      generationCount++;
    }

    const shouldPersist = transactionsToCreate.length > 0 || !recurring.active;

    if (!shouldPersist) {
      return { generatedCount: 0, skipped: false, failed, persisted: false };
    }

    const write = await this.writeGeneratedTransactions(
      recurring,
      transactionsToCreate,
    );

    if (write.outcome === 'skipped-rule-locked') {
      this.logger.warn(
        `Job: recorrência ${recurring.id} em exclusão (skipped-rule-locked); geração ignorada.`,
      );
      return { generatedCount: 0, skipped: true, failed, persisted: false };
    }

    if (write.outcome === 'skipped-rule-gone') {
      this.logger.warn(
        `Job: recorrência ${recurring.id} foi excluída (skipped-rule-gone); geração ignorada.`,
      );
      return {
        generatedCount: 0,
        skipped: true,
        failed: false,
        persisted: false,
      };
    }

    return {
      generatedCount: write.createdCount,
      skipped: false,
      failed,
      persisted: true,
    };
  }

  private async writeGeneratedTransactions(
    recurring: RecurringTransaction,
    transactions: Transaction[],
  ): Promise<GeneratedWriteResult> {
    try {
      return await this.recurringRepository.createGeneratedTransactions(
        transactions,
        recurring,
      );
    } catch (error: unknown) {
      if (!isMissingRecurringRuleViolation(error)) throw error;

      return { outcome: 'skipped-rule-gone' };
    }
  }
}
