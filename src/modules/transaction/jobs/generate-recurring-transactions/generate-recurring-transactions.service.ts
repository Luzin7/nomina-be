import { RecurrenceFrequency, TransactionStatus } from '@constants/enums';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
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

const BATCH_SIZE = 50;
const LOCK_TTL_SECONDS = 300;
const CACHE_TTL_SECONDS = 86400;
const TIMEZONE = 'America/Sao_Paulo';
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

interface Response {
  generatedCount: number;
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

  async execute(): Promise<Either<Error, Response>> {
    let lockAcquired = false;
    let lockKey: string | null = null;

    try {
      const now = this.dateProvider.now();
      const day = this.dateProvider.format(now, 'YYYY-MM-DD', TIMEZONE);

      const cacheKey = `processed:recurring:${day}`;
      lockKey = `lock:recurring:${day}`;

      if (await this.redis.exists(cacheKey)) {
        return right({ generatedCount: 0 });
      }

      lockAcquired = await this.redis.acquireLock(lockKey, LOCK_TTL_SECONDS);
      if (!lockAcquired) {
        return right({ generatedCount: 0 });
      }

      const lookAheadDate = this.dateProvider.add(
        now,
        LOOK_AHEAD_DAYS,
        'day',
        TIMEZONE,
      );

      const generatedCount = await this.generateAll(lookAheadDate);

      await this.redis.set(cacheKey, '1', CACHE_TTL_SECONDS);

      return right({ generatedCount });
    } catch (error: unknown) {
      const err =
        error instanceof Error
          ? error
          : new Error(String(error ?? 'Unknown error'));

      captureException(err);

      return left(new RecurringGenerationFailedError(err.message));
    } finally {
      if (lockAcquired && lockKey) {
        await this.redis.releaseLock(lockKey).catch((e) => captureException(e));
      }
    }
  }

  private async generateAll(lookAheadDate: Date): Promise<number> {
    let generatedCount = 0;
    let afterId: string | null = null;
    let batch: RecurringTransaction[];

    do {
      batch = await this.recurringRepository.listNeedingGeneration(
        lookAheadDate,
        BATCH_SIZE,
        afterId,
      );

      for (const recurring of batch) {
        try {
          const generated = await this.generateTransactionsForRecurring(
            recurring,
            lookAheadDate,
          );
          generatedCount += generated;
        } catch (err: unknown) {
          captureException(err);
        }
      }

      afterId = batch.at(-1)?.id ?? null;
    } while (batch.length === BATCH_SIZE);

    return generatedCount;
  }

  private async generateTransactionsForRecurring(
    recurring: RecurringTransaction,
    thresholdDate: Date,
  ): Promise<number> {
    const transactionsToCreate: Array<Transaction> = [];

    let targetDate = recurring.lastGenerated
      ? this.calculateNextDateService.execute({
          baseDate: recurring.lastGenerated,
          frequency: recurring.frequency,
          interval: recurring.interval,
          timezone: TIMEZONE,
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
        captureException(transactionOrError.value);
        break;
      }

      transactionsToCreate.push(transactionOrError.value);

      recurring.markAsGenerated(targetDate);

      targetDate = this.calculateNextDateService.execute({
        baseDate: targetDate,
        frequency: recurring.frequency,
        interval: recurring.interval,
        timezone: TIMEZONE,
      });
      generationCount++;
    }

    const shouldPersist = transactionsToCreate.length > 0 || !recurring.active;

    if (!shouldPersist) return 0;

    return this.recurringRepository.createGeneratedTransactions(
      transactionsToCreate,
      recurring,
    );
  }
}
