import { RecurrenceFrequency } from '@constants/enums';
import {
  CacheProvider,
  LockHandle,
} from '@infra/cache/contracts/CacheProvider';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { captureException } from '@sentry/nestjs';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { NextGenerationDateCalculator } from '@modules/transaction/services/contracts/NextGenerationDateCalculator';
import { makeRecurring } from '@modules/transaction/test-helpers/mock-factories';
import { CalculateNextGenerationDateService } from '@modules/transaction/services/calculate-next-generation-date.service';
import { Logger } from '@nestjs/common';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { GenerateRecurringTransactionsJobService } from './generate-recurring-transactions.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const mockCaptureException = captureException as jest.MockedFunction<
  typeof captureException
>;

const loggerWarn = jest
  .spyOn(Logger.prototype, 'warn')
  .mockImplementation(() => undefined);
const loggerLog = jest
  .spyOn(Logger.prototype, 'log')
  .mockImplementation(() => undefined);
const loggerError = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

function loggedRedisDegradation(): boolean {
  return loggerWarn.mock.calls.some(([message]) =>
    /redis/i.test(String(message)),
  );
}

function loggedLockOverlap(): boolean {
  return loggerWarn.mock.calls.some(([message]) =>
    /lock/i.test(String(message)),
  );
}

function loggedAlreadyProcessed(): boolean {
  return loggerLog.mock.calls.some(([message]) =>
    /already/i.test(String(message)),
  );
}

describe('GenerateRecurringTransactionsJobService', () => {
  let service: GenerateRecurringTransactionsJobService;
  let recurringRepository: jest.Mocked<RecurringTransactionRepository>;
  let nextGenerationDateCalculator: jest.Mocked<NextGenerationDateCalculator>;
  let redis: jest.Mocked<CacheProvider>;
  let dateProvider: jest.Mocked<DateProvider>;

  const NOW = new Date('2024-01-15T00:00:00.000Z');
  const LOOK_AHEAD = new Date('2024-01-22');
  const DAY = '2024-01-14';
  const calendar = new DayJsDateProvider();
  const LOCK: LockHandle = {
    key: `lock:recurring:${DAY}`,
    token: 'token-1',
  };

  beforeEach(() => {
    recurringRepository = {
      create: jest.fn(),
      update: jest.fn(),
      deleteWithFuturePendingOccurrences: jest.fn(),
      findById: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findNeedingGenerationByWorkspaceId: jest.fn(),
      listNeedingGeneration: jest.fn().mockResolvedValue([]),
      createGeneratedTransactions: jest
        .fn()
        .mockImplementation(async (transactions: Transaction[]) => ({
          outcome: 'written',
          createdCount: transactions.length,
        })),
      findSummaryRules: jest.fn(),
      findCompletedRecurringExpense: jest.fn(),
    } as jest.Mocked<RecurringTransactionRepository>;

    nextGenerationDateCalculator = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<NextGenerationDateCalculator>;

    redis = {
      isEnabled: true,
      onModuleDestroy: jest.fn(),
      ping: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
      del: jest.fn().mockResolvedValue(true),
      exists: jest.fn().mockResolvedValue(false),
      acquireLock: jest.fn().mockResolvedValue(LOCK),
      releaseLock: jest.fn().mockResolvedValue(true),
      delByPattern: jest.fn().mockResolvedValue(0),
      incrementCounter: jest.fn().mockResolvedValue(1),
      getClient: jest.fn().mockReturnValue(null),
      isAvailable: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<CacheProvider>;

    dateProvider = {
      now: jest.fn().mockReturnValue(NOW),
      add: jest.fn().mockReturnValue(LOOK_AHEAD),
      format: jest.fn((date: Date, formatString: string, timezone: string) =>
        calendar.format(date, formatString, timezone),
      ),
      toTimezone: jest.fn(),
      addDaysInCurrentDate: jest.fn(),
      parse: jest.fn(),
      startOfDay: jest.fn(),
      endOfDay: jest.fn(),
      startOfMonth: jest.fn(),
      endOfMonth: jest.fn(),
    } as unknown as jest.Mocked<DateProvider>;

    service = new GenerateRecurringTransactionsJobService(
      recurringRepository,
      nextGenerationDateCalculator,
      redis,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  function setRedisEnabled(value: boolean): void {
    (redis as unknown as { isEnabled: boolean }).isEnabled = value;
  }

  it('skips when the day is already cached', async () => {
    redis.exists.mockResolvedValue(true);

    const result = await service.execute();

    expect(result.isRight()).toBe(true);
    if (result.isRight())
      expect(result.value).toEqual({
        outcome: 'skipped-already-processed',
        generatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        processedCount: 0,
      });
    expect(redis.acquireLock).not.toHaveBeenCalled();
    expect(recurringRepository.listNeedingGeneration).not.toHaveBeenCalled();
    expect(loggedAlreadyProcessed()).toBe(true);
  });

  it('skips when the lock is not acquired', async () => {
    redis.acquireLock.mockResolvedValue(null);

    const result = await service.execute();

    expect(result.isRight()).toBe(true);
    if (result.isRight())
      expect(result.value).toEqual({
        outcome: 'skipped-lock-held',
        generatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        processedCount: 0,
      });
    expect(recurringRepository.listNeedingGeneration).not.toHaveBeenCalled();
    expect(loggedLockOverlap()).toBe(true);
  });

  it('returns left and reports when redis is enabled but unavailable', async () => {
    setRedisEnabled(true);
    redis.acquireLock.mockRejectedValue(new Error('redis down'));

    const result = await service.execute();

    expect(result.isLeft()).toBe(true);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(recurringRepository.listNeedingGeneration).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('generates and warns when redis is disabled', async () => {
    setRedisEnabled(false);

    const result = await service.execute();

    expect(result.isRight()).toBe(true);
    expect(recurringRepository.listNeedingGeneration).toHaveBeenCalled();
    expect(loggedRedisDegradation()).toBe(true);
  });

  it('derives the day and cache key from the DateProvider timezone', async () => {
    await service.execute();

    expect(dateProvider.format).toHaveBeenCalledWith(
      NOW,
      'YYYY-MM-DD',
      'America/Sao_Paulo',
    );
    expect(dateProvider.add).toHaveBeenCalledWith(
      NOW,
      7,
      'day',
      'America/Sao_Paulo',
    );
    expect(redis.exists).toHaveBeenCalledWith(`processed:recurring:${DAY}`);
  });

  it('marks the day as processed and releases the lock on success', async () => {
    await service.execute();

    expect(redis.set).toHaveBeenCalledWith(
      `processed:recurring:${DAY}`,
      '1',
      86400,
    );
    expect(redis.releaseLock).toHaveBeenCalledWith(LOCK);
  });

  it('returns left and does not release a lock it never acquired when the cache check throws', async () => {
    redis.exists.mockRejectedValue(new Error('redis down'));

    const result = await service.execute();

    expect(result.isLeft()).toBe(true);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  it('returns left, reports and releases the lock on a critical error', async () => {
    recurringRepository.listNeedingGeneration.mockRejectedValue(
      new Error('db down'),
    );

    const result = await service.execute();

    expect(result.isLeft()).toBe(true);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(redis.releaseLock).toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('queries with the look-ahead reference date', async () => {
    await service.execute();

    expect(recurringRepository.listNeedingGeneration).toHaveBeenCalledWith(
      LOOK_AHEAD,
      50,
      null,
    );
  });

  it('advances the keyset cursor across full batches', async () => {
    const fullBatch = Array.from({ length: 50 }, (_, i) =>
      makeRecurring({
        id: `r-${String(i).padStart(3, '0')}`,
        startDate: new Date('2024-01-10'),
      }),
    );
    recurringRepository.listNeedingGeneration
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );

    const result = await service.execute();

    expect(recurringRepository.listNeedingGeneration).toHaveBeenCalledTimes(2);
    expect(recurringRepository.listNeedingGeneration.mock.calls[0][2]).toBe(
      null,
    );
    expect(recurringRepository.listNeedingGeneration.mock.calls[1][2]).toBe(
      'r-049',
    );
    if (result.isRight()) expect(result.value.generatedCount).toBe(50);
  });

  it('generates due transactions and marks the recurring as generated', async () => {
    const recurring = makeRecurring({ startDate: new Date('2024-01-10') });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );

    const result = await service.execute();

    expect(
      recurringRepository.createGeneratedTransactions,
    ).toHaveBeenCalledTimes(1);
    const [transactions, updatedRecurring] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(transactions).toHaveLength(1);
    expect(updatedRecurring.lastGenerated).toEqual(new Date('2024-01-10'));
    if (result.isRight()) expect(result.value.generatedCount).toBe(1);
  });

  it('invalidates the report cache once per workspace that persisted', async () => {
    recurringRepository.listNeedingGeneration.mockResolvedValue([
      makeRecurring({
        id: 'r-a1',
        workspaceId: 'ws-a',
        startDate: new Date('2024-01-10'),
      }),
      makeRecurring({
        id: 'r-a2',
        workspaceId: 'ws-a',
        startDate: new Date('2024-01-10'),
      }),
      makeRecurring({
        id: 'r-b1',
        workspaceId: 'ws-b',
        startDate: new Date('2024-01-10'),
      }),
    ]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );

    await service.execute();

    expect(redis.incrementCounter).toHaveBeenCalledTimes(2);
    expect(redis.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:report:ws-a',
      expect.any(Number),
    );
    expect(redis.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:report:ws-b',
      expect.any(Number),
    );
  });

  it('does not invalidate the report cache when nothing is due', async () => {
    await service.execute();

    expect(redis.incrementCounter).not.toHaveBeenCalled();
  });

  it('invalidates already persisted workspaces and propagates the error when a later batch fails', async () => {
    const fullBatch = Array.from({ length: 50 }, (_, i) =>
      makeRecurring({
        id: `r-${String(i).padStart(3, '0')}`,
        workspaceId: 'ws-a',
        startDate: new Date('2024-01-10'),
      }),
    );
    recurringRepository.listNeedingGeneration
      .mockResolvedValueOnce(fullBatch)
      .mockRejectedValueOnce(new Error('db down'));
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );

    const result = await service.execute();

    expect(result.isLeft()).toBe(true);
    expect(result.value).toMatchObject({
      message: expect.stringContaining('db down'),
    });
    expect(redis.incrementCounter).toHaveBeenCalledTimes(1);
    expect(redis.incrementCounter).toHaveBeenCalledWith(
      'cache-gen:report:ws-a',
      expect.any(Number),
    );
  });

  it('reports the count the repository inserted, not the batch size', async () => {
    const recurring = makeRecurring({ startDate: new Date('2024-01-10') });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-01-11'),
    );
    recurringRepository.createGeneratedTransactions.mockResolvedValue({
      outcome: 'written',
      createdCount: 5,
    });

    const result = await service.execute();

    const [transactions] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(transactions).toHaveLength(24);
    if (result.isRight()) expect(result.value.generatedCount).toBe(5);
  });

  it('isolates a bad row without aborting the run', async () => {
    const forged = makeRecurring({
      id: 'r-bad',
      startDate: new Date('2024-01-01'),
    });
    Object.defineProperty(forged, 'frequency', { get: () => 'QUINZENAL' });
    const valid = makeRecurring({
      id: 'r-good',
      startDate: new Date('2024-01-10'),
    });
    recurringRepository.listNeedingGeneration.mockResolvedValue([
      forged,
      valid,
    ]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );

    const result = await service.execute();

    expect(result.isRight()).toBe(true);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(
      recurringRepository.createGeneratedTransactions,
    ).toHaveBeenCalledTimes(1);
    const [transactions, updatedRecurring] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(transactions).toHaveLength(1);
    expect(transactions[0].recurringId).toBe('r-good');
    expect(updatedRecurring.id).toBe('r-good');
    if (result.isRight()) expect(result.value.generatedCount).toBe(1);
  });

  it('skips a rule whose generated write lost the delete lock and keeps the run going', async () => {
    recurringRepository.listNeedingGeneration.mockResolvedValue([
      makeRecurring({ id: 'r-locked', startDate: new Date('2024-01-10') }),
      makeRecurring({ id: 'r-free', startDate: new Date('2024-01-10') }),
    ]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );
    recurringRepository.createGeneratedTransactions
      .mockResolvedValueOnce({ outcome: 'skipped-rule-locked' })
      .mockResolvedValueOnce({ outcome: 'written', createdCount: 1 });

    const result = await service.execute();

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('r-locked'),
    );
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('skipped-rule-locked'),
    );
    expect(
      recurringRepository.createGeneratedTransactions,
    ).toHaveBeenCalledTimes(2);
    if (result.isRight())
      expect(result.value).toEqual({
        outcome: 'success',
        generatedCount: 1,
        skippedCount: 1,
        failedCount: 0,
        processedCount: 2,
      });
  });

  it('counts an all-skipped batch as skipped instead of indistinguishable from nothing to write', async () => {
    recurringRepository.listNeedingGeneration.mockResolvedValue([
      makeRecurring({ id: 'r-locked-a', startDate: new Date('2024-01-10') }),
      makeRecurring({ id: 'r-locked-b', startDate: new Date('2024-01-10') }),
    ]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );
    recurringRepository.createGeneratedTransactions
      .mockResolvedValueOnce({ outcome: 'skipped-rule-locked' })
      .mockResolvedValueOnce({ outcome: 'skipped-rule-locked' });

    const result = await service.execute();

    if (result.isRight())
      expect(result.value).toEqual({
        outcome: 'success',
        generatedCount: 0,
        skippedCount: 2,
        failedCount: 0,
        processedCount: 2,
      });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('skips a rule deleted between the lock attempt and the insert without a failure', async () => {
    recurringRepository.listNeedingGeneration.mockResolvedValue([
      makeRecurring({ id: 'r-gone', startDate: new Date('2024-01-10') }),
      makeRecurring({ id: 'r-alive', startDate: new Date('2024-01-10') }),
    ]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );
    recurringRepository.createGeneratedTransactions
      .mockRejectedValueOnce(
        new DrizzleQueryError(
          'insert into "transactions" ...',
          [],
          Object.assign(
            new Error(
              'insert or update on table "transactions" violates foreign key constraint "transactions_recurring_transaction_id_recurring_transactions_id"',
            ),
            { code: '23503' },
          ),
        ),
      )
      .mockResolvedValueOnce({ outcome: 'written', createdCount: 1 });

    const result = await service.execute();

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('skipped-rule-gone'),
    );
    expect(mockCaptureException).not.toHaveBeenCalled();
    if (result.isRight())
      expect(result.value).toEqual({
        outcome: 'success',
        generatedCount: 1,
        skippedCount: 1,
        failedCount: 0,
        processedCount: 2,
      });
  });

  it('reports a foreign key violation from another constraint as a failure', async () => {
    recurringRepository.listNeedingGeneration.mockResolvedValue([
      makeRecurring({ id: 'r-other-fk', startDate: new Date('2024-01-10') }),
    ]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );
    recurringRepository.createGeneratedTransactions.mockRejectedValue(
      new DrizzleQueryError(
        'insert into "transactions" ...',
        [],
        Object.assign(
          new Error(
            'insert or update on table "transactions" violates foreign key constraint "transactions_account_id_accounts_id_fkey"',
          ),
          { code: '23503' },
        ),
      ),
    );

    const result = await service.execute();

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    if (result.isRight())
      expect(result.value).toEqual({
        outcome: 'total-failure',
        generatedCount: 0,
        skippedCount: 0,
        failedCount: 1,
        processedCount: 1,
      });
  });

  it('reports invalid data without persisting and keeps the recurring active', async () => {
    const recurring = makeRecurring({ startDate: new Date('2024-01-10') });
    Object.defineProperty(recurring, 'amount', { get: () => 0n });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-01-11'),
    );

    const result = await service.execute();

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(
      recurringRepository.createGeneratedTransactions,
    ).not.toHaveBeenCalled();
    if (result.isRight()) expect(result.value.generatedCount).toBe(0);
  });

  it('stops at the monthly safety cap', async () => {
    const recurring = makeRecurring({ startDate: new Date('2024-01-10') });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-01-11'),
    );

    const result = await service.execute();

    const [transactions] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(transactions).toHaveLength(24);
    if (result.isRight()) expect(result.value.generatedCount).toBe(24);
  });

  it('deactivates the recurring once generation passes its endDate', async () => {
    const recurring = makeRecurring({
      startDate: new Date('2023-11-10'),
      endDate: new Date('2024-01-10'),
    });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute
      .mockReturnValueOnce(new Date('2024-01-10'))
      .mockReturnValueOnce(new Date('2024-01-15'));

    await service.execute();

    const [transactions, updatedRecurring] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(transactions).toHaveLength(2);
    expect(updatedRecurring.active).toBe(false);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        `plano esgotado pela data final; recorrência ${recurring.id} (workspace ${recurring.workspaceId}) na última geração 2024-01-09, data alvo 2024-01-14`,
      ),
    );
  });

  it('logs the installment count when it exhausts the plan', async () => {
    dateProvider.add
      .mockReturnValueOnce(new Date('2024-04-20'))
      .mockReturnValue(new Date('2024-03-10'));
    const recurring = makeRecurring({
      startDate: new Date('2024-01-10'),
      installmentCount: 3,
    });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-04-01'),
    );

    await service.execute();

    const [transactions, updatedRecurring] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(transactions).toHaveLength(1);
    expect(updatedRecurring.active).toBe(false);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        `plano esgotado pela contagem de parcelas; recorrência ${recurring.id} (workspace ${recurring.workspaceId}) na última geração 2024-01-09, data alvo 2024-03-31`,
      ),
    );
  });

  it('persists the deactivation even with zero generated transactions', async () => {
    const recurring = makeRecurring({
      lastGenerated: new Date('2024-01-01'),
      endDate: new Date('2024-01-10'),
    });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-01-15'),
    );

    const result = await service.execute();

    expect(
      recurringRepository.createGeneratedTransactions,
    ).toHaveBeenCalledTimes(1);
    const [transactions, updatedRecurring] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(transactions).toHaveLength(0);
    expect(updatedRecurring.active).toBe(false);
    if (result.isRight()) expect(result.value.generatedCount).toBe(0);
  });

  it('keeps the recurring active when there is no endDate', async () => {
    const recurring = makeRecurring({ startDate: new Date('2024-01-10') });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );

    await service.execute();

    const [, updatedRecurring] =
      recurringRepository.createGeneratedTransactions.mock.calls[0];
    expect(updatedRecurring.active).toBe(true);
  });

  it('reports an empty range as nothing due', async () => {
    recurringRepository.listNeedingGeneration.mockResolvedValue([]);

    const result = await service.execute();

    expect(result.isRight()).toBe(true);
    if (result.isRight())
      expect(result.value).toEqual({
        outcome: 'nothing-due',
        generatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        processedCount: 0,
      });
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('reports total failure when every recurrence throws', async () => {
    const recurrings = ['r-1', 'r-2', 'r-3'].map((id) =>
      makeRecurring({ id, startDate: new Date('2024-01-10') }),
    );
    recurringRepository.listNeedingGeneration.mockResolvedValue(recurrings);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );
    const driverError = Object.assign(
      new Error(
        'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      ),
      { code: '42P10' },
    );
    recurringRepository.createGeneratedTransactions.mockRejectedValue(
      new DrizzleQueryError('insert into "transactions" ...', [], driverError),
    );

    const result = await service.execute();

    expect(result.isRight()).toBe(true);
    if (result.isRight())
      expect(result.value).toEqual({
        outcome: 'total-failure',
        generatedCount: 0,
        skippedCount: 0,
        failedCount: 3,
        processedCount: 3,
      });
    expect(mockCaptureException).toHaveBeenCalledTimes(3);
    expect(String(loggerError.mock.calls[0][0])).toContain('r-1');
    expect(String(loggerError.mock.calls[0][0])).toContain('sqlState=42P10');
  });

  it('reports partial failure when only some recurrences throw', async () => {
    recurringRepository.listNeedingGeneration.mockResolvedValue([
      makeRecurring({ id: 'r-good', startDate: new Date('2024-01-10') }),
      makeRecurring({ id: 'r-bad', startDate: new Date('2024-01-10') }),
    ]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );
    recurringRepository.createGeneratedTransactions
      .mockResolvedValueOnce({ outcome: 'written', createdCount: 1 })
      .mockRejectedValueOnce(new Error('db down'));

    const result = await service.execute();

    if (result.isRight())
      expect(result.value).toEqual({
        outcome: 'partial-failure',
        generatedCount: 1,
        skippedCount: 0,
        failedCount: 1,
        processedCount: 2,
      });
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(String(loggerError.mock.calls[0][0])).toContain('sqlState=none');
  });

  it('passes the rule start date as the anchor of the next date', async () => {
    const recurring = makeRecurring({ startDate: new Date('2024-01-10') });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-02-10'),
    );

    await service.execute();

    expect(nextGenerationDateCalculator.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorDate: new Date('2024-01-10'),
        baseDate: new Date('2024-01-10'),
      }),
    );
  });

  describe('with the real next date calculator', () => {
    beforeEach(() => {
      service = new GenerateRecurringTransactionsJobService(
        recurringRepository,
        new CalculateNextGenerationDateService(new DayJsDateProvider()),
        redis,
        dateProvider,
      );
    });

    it.each([
      ['2026-01-31', 'MONTHLY', 1, '2026-02-28', '2026-03-31'],
      ['2026-01-31', 'MONTHLY', 1, '2026-03-28', '2026-04-30'],
      ['2024-02-29', 'YEARLY', 1, '2025-02-28', '2026-02-28'],
      ['2026-01-31', 'MONTHLY', 2, '2026-03-28', '2026-05-31'],
    ])(
      'anchor %s %s every %i after %s generates %s',
      async (start, frequency, interval, last, expected) => {
        const recurring = makeRecurring({
          startDate: new Date(`${start}T12:00:00.000Z`),
          frequency: frequency as RecurrenceFrequency,
          interval,
          lastGenerated: new Date(`${last}T12:00:00.000Z`),
        });
        recurringRepository.listNeedingGeneration.mockResolvedValue([
          recurring,
        ]);
        dateProvider.add.mockReturnValue(new Date(`${expected}T13:00:00.000Z`));

        await service.execute();

        const [transactions] =
          recurringRepository.createGeneratedTransactions.mock.calls[0];
        expect(transactions.map((transaction) => transaction.date)).toEqual([
          new Date(`${expected}T12:00:00.000Z`),
        ]);
      },
    );

    it('creates no second row when the generation runs twice', async () => {
      const recurring = makeRecurring({
        startDate: new Date('2024-01-10T12:00:00.000Z'),
      });
      recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);

      await service.execute();
      await service.execute();

      expect(
        recurringRepository.createGeneratedTransactions,
      ).toHaveBeenCalledTimes(1);
    });
  });
});
