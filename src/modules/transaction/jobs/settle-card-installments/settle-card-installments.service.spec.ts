import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { TransactionAlreadyCompletedError } from '@modules/transaction/errors';
import { TransactionRepository } from '@modules/transaction/repositories/contracts/TransactionRepository';
import { Transaction } from '@modules/transaction/entities/Transaction';
import { makeTransaction } from '@modules/transaction/test-helpers/mock-factories';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { captureException } from '@sentry/nestjs';
import { left, right } from '@shared/core/errors/Either';
import { TransactionStatus } from '@constants/enums';
import { Logger } from '@nestjs/common';
import { SettleCardInstallmentsJobService } from './settle-card-installments.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const loggerWarn = jest
  .spyOn(Logger.prototype, 'warn')
  .mockImplementation(() => undefined);

const NOW = new Date('2024-01-15T12:00:00.000Z');

function dueOf(transactions: Transaction[], totalDue = transactions.length) {
  return { transactions, totalDue };
}

function makeDue(id: string, workspaceId = 'ws-1') {
  return makeTransaction({
    id,
    workspaceId,
    status: TransactionStatus.PENDING,
    date: new Date('2024-01-10T12:00:00.000Z'),
  });
}

describe('SettleCardInstallmentsJobService', () => {
  let service: SettleCardInstallmentsJobService;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let cache: jest.Mocked<CacheProvider>;
  let dateProvider: jest.Mocked<DateProvider>;

  beforeEach(() => {
    transactionRepository = {
      findDueCardTransactions: jest
        .fn()
        .mockResolvedValue({ transactions: [], totalDue: 0 }),
      updateStatusWithBalanceEffect: jest.fn(),
    } as unknown as jest.Mocked<TransactionRepository>;
    cache = {
      delByPattern: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<CacheProvider>;
    dateProvider = {
      now: jest.fn().mockReturnValue(NOW),
    } as unknown as jest.Mocked<DateProvider>;

    service = new SettleCardInstallmentsJobService(
      transactionRepository,
      cache,
      dateProvider,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('should settle due card transactions', async () => {
    const due = [makeDue('tx-1'), makeDue('tx-2')];
    transactionRepository.findDueCardTransactions.mockResolvedValue(dueOf(due));
    transactionRepository.updateStatusWithBalanceEffect.mockImplementation(
      async ({ transactionId }) =>
        right(due.find((tx) => tx.id === transactionId)!),
    );

    const summary = await service.execute();

    expect(summary).toEqual({
      outcome: 'success',
      settledCount: 2,
      skippedCount: 0,
      failedCount: 0,
      processedCount: 2,
      remainingCount: 0,
    });
    expect(
      transactionRepository.updateStatusWithBalanceEffect,
    ).toHaveBeenCalledWith(
      {
        transactionId: 'tx-1',
        workspaceId: 'ws-1',
        status: TransactionStatus.COMPLETED,
        scheduledSettlement: true,
      },
      expect.objectContaining({ actorId: expect.any(String) }),
    );
    expect(cache.delByPattern).toHaveBeenCalledWith('report:*:ws-1:*');
  });

  it('should ask the repository for rows due at the current time', async () => {
    const summary = await service.execute();

    expect(transactionRepository.findDueCardTransactions).toHaveBeenCalledWith(
      NOW,
      expect.any(Number),
    );
    expect(summary.outcome).toBe('nothing-due');
  });

  it('should keep going when one transaction fails', async () => {
    const due = [makeDue('tx-1'), makeDue('tx-2'), makeDue('tx-3')];
    transactionRepository.findDueCardTransactions.mockResolvedValue(dueOf(due));
    transactionRepository.updateStatusWithBalanceEffect
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(right(due[1]));

    const summary = await service.execute();

    expect(summary).toMatchObject({
      outcome: 'partial-failure',
      settledCount: 2,
      failedCount: 1,
      processedCount: 3,
    });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('should settle nothing on a second run', async () => {
    const due = [makeDue('tx-1')];
    transactionRepository.findDueCardTransactions
      .mockResolvedValueOnce(dueOf(due))
      .mockResolvedValueOnce(dueOf([]));
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      right(due[0]),
    );

    await service.execute();
    const second = await service.execute();

    expect(second.settledCount).toBe(0);
    expect(
      transactionRepository.updateStatusWithBalanceEffect,
    ).toHaveBeenCalledTimes(1);
  });

  it('should count a concurrent completion as skipped, not failed', async () => {
    transactionRepository.findDueCardTransactions.mockResolvedValue(
      dueOf([makeDue('tx-1')]),
    );
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      left(new TransactionAlreadyCompletedError()),
    );

    const summary = await service.execute();

    expect(summary).toMatchObject({
      outcome: 'success',
      settledCount: 0,
      skippedCount: 1,
      failedCount: 0,
    });
    expect(cache.delByPattern).not.toHaveBeenCalled();
  });

  it('should report total failure when every transaction fails', async () => {
    transactionRepository.findDueCardTransactions.mockResolvedValue(
      dueOf([makeDue('tx-1')]),
    );
    transactionRepository.updateStatusWithBalanceEffect.mockRejectedValue(
      new Error('db down'),
    );

    const summary = await service.execute();

    expect(summary.outcome).toBe('total-failure');
  });

  it('should send a single aggregated Sentry event for many failures', async () => {
    const due = Array.from({ length: 8 }, (_, i) => makeDue(`tx-${i}`));
    transactionRepository.findDueCardTransactions.mockResolvedValue(dueOf(due));
    transactionRepository.updateStatusWithBalanceEffect.mockRejectedValue(
      new Error('db down'),
    );

    await service.execute();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: expect.objectContaining({
        failedCount: 8,
        processedCount: 8,
        sample: expect.arrayContaining([
          expect.objectContaining({ transactionId: 'tx-0' }),
        ]),
      }),
    });
    expect(loggerWarn).toHaveBeenCalledTimes(8);
  });

  it('should not send a Sentry event when nothing failed', async () => {
    const due = [makeDue('tx-1')];
    transactionRepository.findDueCardTransactions.mockResolvedValue(dueOf(due));
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      right(due[0]),
    );

    await service.execute();

    expect(captureException).not.toHaveBeenCalled();
  });

  it('should stop picking rows after the time budget and report what remains', async () => {
    const due = [makeDue('tx-1'), makeDue('tx-2'), makeDue('tx-3')];
    transactionRepository.findDueCardTransactions.mockResolvedValue(
      dueOf(due, 10),
    );
    transactionRepository.updateStatusWithBalanceEffect.mockResolvedValue(
      right(due[0]),
    );
    const OVER_BUDGET = new Date(NOW.getTime() + 31_000);
    dateProvider.now
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW)
      .mockReturnValue(OVER_BUDGET);

    const summary = await service.execute();

    expect(summary).toMatchObject({
      outcome: 'success',
      settledCount: 2,
      processedCount: 2,
      remainingCount: 8,
    });
    expect(
      transactionRepository.updateStatusWithBalanceEffect,
    ).toHaveBeenCalledTimes(2);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('8 card transaction(s) left'),
    );
  });
});
