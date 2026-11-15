import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { AccountRepository } from '@modules/account/repositories/contracts/AccountRepository';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { InvalidProjectionHorizonError } from '@modules/report/errors';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { Logger } from '@nestjs/common';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { GetProjectionService } from './get-projection.handler';

const NOW = new Date('2026-10-15T12:00:00.000Z');

const buildService = () => {
  const dateProvider = new DayJsDateProvider();
  const accountRepository = {
    findAllByWorkspaceId: jest.fn().mockResolvedValue([]),
  } as unknown as AccountRepository;
  const monthProjectionRepository = {
    findMonthLedger: jest.fn().mockResolvedValue([]),
    findActiveRecurringRules: jest.fn().mockResolvedValue([]),
    findPendingInstallments: jest.fn().mockResolvedValue([]),
  } as unknown as MonthProjectionRepository;
  const budgetRepository = {
    resolveSnapshots: jest.fn().mockResolvedValue([]),
  } as unknown as BudgetRepository;
  const workspaceTimezone = {
    execute: jest.fn().mockResolvedValue('America/Sao_Paulo'),
  } as unknown as GetWorkspaceTimezoneService;

  jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

  const service = new GetProjectionService(
    accountRepository,
    monthProjectionRepository,
    budgetRepository,
    workspaceTimezone,
    dateProvider,
    new InMemoryCacheProvider(),
  );

  return {
    service,
    monthProjectionRepository,
    budgetRepository,
    accountRepository,
  };
};

const request = { workspaceId: 'ws-1', sub: 'user-1' };

describe('GetProjectionService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns six ordered months by default', async () => {
    const { service } = buildService();

    const result = await service.execute(request);

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;

    expect(result.value.horizon).toBe(6);
    expect(result.value.projection.months.map((month) => month.key)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
  });

  it('honours the requested horizon', async () => {
    const { service } = buildService();

    const result = await service.execute({ ...request, months: 3 });

    expect(result.isRight()).toBe(true);
    if (result.isLeft()) return;
    expect(result.value.projection.months).toHaveLength(3);
  });

  it('keeps every month internally consistent', async () => {
    const { service } = buildService();

    const result = await service.execute(request);

    if (result.isLeft()) throw result.value;
    const { projection } = result.value;

    for (const month of projection.months) {
      expect(month.netCents).toBe(month.inflowCents - month.outflowCents);
      expect(month.shortfallCents).toBe(
        month.status === 'insufficient' ? 0 : Math.max(0, -month.netCents),
      );
    }

    const [current, ...later] = projection.months;
    const realizedNet =
      current.sources.realized.totalIncome -
      current.sources.realized.totalExpense;
    const accumulated =
      current.netCents -
      realizedNet +
      later.reduce((total, month) => total + month.netCents, 0);

    expect(projection.months.at(-1)?.endBalanceCents).toBe(
      projection.openingBalanceCents + accumulated,
    );
  });

  it('feeds pending installments into their month and agrees with the scheduled totals', async () => {
    const { service, monthProjectionRepository } = buildService();

    (monthProjectionRepository.findMonthLedger as jest.Mock).mockResolvedValue([
      {
        key: '2026-11',
        totalIncome: 0,
        totalExpense: 0,
        pending: { totalIncome: 0, totalExpense: 7000 },
        plainExpenses: [],
      },
    ]);
    (
      monthProjectionRepository.findPendingInstallments as jest.Mock
    ).mockResolvedValue([
      {
        date: new Date('2026-11-10T03:00:00.000Z'),
        amount: 7000,
        type: 'EXPENSE',
        recurringId: 'card-1',
        installmentNumber: 1,
        installmentCount: 12,
      },
    ]);

    const result = await service.execute(request);

    if (result.isLeft()) throw result.value;

    const november = result.value.projection.months[1];

    expect(november.pendingInstallments).toHaveLength(1);
    expect(november.pendingInstallments[0].amountCents).toBe(7000);
    expect(november.sources.scheduled.totalExpense).toBe(7000);
    expect(
      november.pendingInstallments.reduce(
        (total, row) => total + row.amountCents,
        0,
      ),
    ).toBe(november.sources.scheduled.totalExpense);
  });

  it('rejects a horizon outside 1..12 without touching a repository', async () => {
    const { service, monthProjectionRepository, accountRepository } =
      buildService();

    for (const months of [0, 13, 1.5, Number.NaN]) {
      const result = await service.execute({ ...request, months });

      expect(result.isLeft()).toBe(true);
      if (result.isRight()) continue;
      expect(result.value).toBeInstanceOf(InvalidProjectionHorizonError);
    }

    expect(accountRepository.findAllByWorkspaceId).not.toHaveBeenCalled();
    expect(monthProjectionRepository.findMonthLedger).not.toHaveBeenCalled();
  });

  it('reads the horizon in one batched pass', async () => {
    const {
      service,
      monthProjectionRepository,
      budgetRepository,
      accountRepository,
    } = buildService();

    await service.execute(request);

    expect(accountRepository.findAllByWorkspaceId).toHaveBeenCalledTimes(1);
    expect(monthProjectionRepository.findMonthLedger).toHaveBeenCalledTimes(1);
    expect(
      monthProjectionRepository.findActiveRecurringRules,
    ).toHaveBeenCalledTimes(1);
    expect(
      monthProjectionRepository.findPendingInstallments,
    ).toHaveBeenCalledTimes(1);
    expect(budgetRepository.resolveSnapshots).toHaveBeenCalledTimes(1);
    expect(budgetRepository.resolveSnapshots).toHaveBeenCalledWith(
      'ws-1',
      expect.arrayContaining([expect.any(Date)]),
    );
    expect(
      (budgetRepository.resolveSnapshots as jest.Mock).mock.calls[0][1],
    ).toHaveLength(6);
  });

  it('logs step, workspace, months and elapsed ms then rethrows when a read fails', async () => {
    const { service, monthProjectionRepository } = buildService();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    (monthProjectionRepository.findMonthLedger as jest.Mock).mockRejectedValue(
      new Error('db down'),
    );

    await expect(service.execute({ ...request, months: 3 })).rejects.toThrow(
      'db down',
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /step=load-bundle workspaceId=ws-1 months=3 elapsedMs=\d+ error=db down/,
      ),
    );
  });

  it('does not log for an invalid horizon', async () => {
    const { service } = buildService();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await service.execute({ ...request, months: 0 });

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
