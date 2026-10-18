import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { captureException } from '@sentry/nestjs';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { RecurringTransactionRepository } from '@modules/transaction/repositories/contracts/RecurringTransactionRepository';
import { NextGenerationDateCalculator } from '@modules/transaction/services/contracts/NextGenerationDateCalculator';
import { makeRecurring } from '@modules/transaction/test-helpers/mock-factories';
import { Logger } from '@nestjs/common';
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
  const DAY = '2024-01-15';

  beforeEach(() => {
    recurringRepository = {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findById: jest.fn(),
      findManyByWorkspaceId: jest.fn(),
      findNeedingGenerationByWorkspaceId: jest.fn(),
      listNeedingGeneration: jest.fn().mockResolvedValue([]),
      createGeneratedTransactions: jest
        .fn()
        .mockImplementation(
          async (transactions: Transaction[]) => transactions.length,
        ),
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
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(true),
      delByPattern: jest.fn().mockResolvedValue(0),
      getClient: jest.fn().mockReturnValue(null),
      isAvailable: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<CacheProvider>;

    dateProvider = {
      now: jest.fn().mockReturnValue(NOW),
      add: jest.fn().mockReturnValue(LOOK_AHEAD),
      format: jest.fn().mockReturnValue(DAY),
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
    if (result.isRight()) expect(result.value.generatedCount).toBe(0);
    expect(redis.acquireLock).not.toHaveBeenCalled();
    expect(recurringRepository.listNeedingGeneration).not.toHaveBeenCalled();
    expect(loggedAlreadyProcessed()).toBe(true);
  });

  it('skips when the lock is not acquired', async () => {
    redis.acquireLock.mockResolvedValue(false);

    const result = await service.execute();

    expect(result.isRight()).toBe(true);
    if (result.isRight()) expect(result.value.generatedCount).toBe(0);
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
    expect(redis.releaseLock).toHaveBeenCalled();
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

  it('reports the count the repository inserted, not the batch size', async () => {
    const recurring = makeRecurring({ startDate: new Date('2024-01-10') });
    recurringRepository.listNeedingGeneration.mockResolvedValue([recurring]);
    nextGenerationDateCalculator.execute.mockReturnValue(
      new Date('2024-01-11'),
    );
    recurringRepository.createGeneratedTransactions.mockResolvedValue(5);

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
});
