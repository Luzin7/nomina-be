import { RecurrenceFrequency, TransactionStatus } from '@constants/enums';
import { RECURRING_GENERATION_TIMEZONE } from '@constants/timezone';
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
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { NextGenerationDateCalculator } from '@modules/transaction/services/contracts/NextGenerationDateCalculator';
import { Injectable, Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { captureException } from '@sentry/nestjs';
import { Either, left, right } from '@shared/core/errors/Either';
import { getErrorDetails } from '@shared/utils/error-details';

const BATCH_SIZE = 50;
const LOCK_TTL_SECONDS = 300;
const CACHE_TTL_SECONDS = 86400;
const LOOK_AHEAD_DAYS = 7;

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
  failedCount: number;
  processedCount: number;
}

interface GenerationCounters {
  generatedCount: number;
  failedCount: number;
  processedCount: number;
}

interface RecurrenceOutcome {
  generatedCount: number;
  failed: boolean;
}

function skippedSummary(
  outcome: Extract<
    RecurringGenerationOutcome,
    'skipped-already-processed' | 'skipped-lock-held'
  >,
): GenerateRecurringTransactionsSummary {
  return { outcome, generatedCount: 0, failedCount: 0, processedCount: 0 };
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
        RECURRING_GENERATION_TIMEZONE,
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
        RECURRING_GENERATION_TIMEZONE,
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
      failedCount: 0,
      processedCount: 0,
    };
    let afterId: string | null = null;
    let batch: RecurringTransaction[];

    do {
      batch = await this.recurringRepository.listNeedingGeneration(
        lookAheadDate,
        BATCH_SIZE,
        afterId,
      );

      for (const recurring of batch) {
        counters.processedCount++;

        const outcome = await this.generateForRecurring(
          recurring,
          lookAheadDate,
        );
        counters.generatedCount += outcome.generatedCount;

        if (outcome.failed) counters.failedCount++;
      }

      afterId = batch.at(-1)?.id ?? null;
    } while (batch.length === BATCH_SIZE);

    return counters;
  }

  private async generateForRecurring(
    recurring: RecurringTransaction,
    thresholdDate: Date,
  ): Promise<RecurrenceOutcome> {
    try {
      return await this.generateTransactionsForRecurring(
        recurring,
        thresholdDate,
      );
    } catch (error: unknown) {
      this.reportRecurringFailure(recurring.id, error);
      return { generatedCount: 0, failed: true };
    }
  }

  private reportRecurringFailure(recurringId: string, error: unknown): void {
    captureException(error);

    const { sqlState, messageChain } = getErrorDetails(error);

    this.logger.error(
      `Failed to generate recurring transactions for ${recurringId} (sqlState=${sqlState ?? 'none'}): ${messageChain}`,
    );
  }

  private async generateTransactionsForRecurring(
    recurring: RecurringTransaction,
    thresholdDate: Date,
  ): Promise<RecurrenceOutcome> {
    const transactionsToCreate: Array<Transaction> = [];
    let failed = false;

    let targetDate = recurring.lastGenerated
      ? this.calculateNextDateService.execute({
          baseDate: recurring.lastGenerated,
          frequency: recurring.frequency,
          interval: recurring.interval,
          timezone: RECURRING_GENERATION_TIMEZONE,
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

      if (recurring.endDate && targetDate > recurring.endDate) {
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
        baseDate: targetDate,
        frequency: recurring.frequency,
        interval: recurring.interval,
        timezone: RECURRING_GENERATION_TIMEZONE,
      });
      generationCount++;
    }

    const shouldPersist = transactionsToCreate.length > 0 || !recurring.active;

    if (!shouldPersist) return { generatedCount: 0, failed };

    const generatedCount =
      await this.recurringRepository.createGeneratedTransactions(
        transactionsToCreate,
        recurring,
      );

    return { generatedCount, failed };
  }
}
