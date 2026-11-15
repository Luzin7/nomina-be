import { RecurrenceFrequency } from '@constants/enums';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import {
  LedgerMonth,
  RecurringRuleSnapshot,
} from '@modules/report/valueObjects/MonthProjection';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  ResolveMonthPlanService,
  type ResolvedMonthPlan,
} from './resolve-month-plan.service';

const WORKSPACE_ID = 'ws-1';
const SAO_PAULO = 'America/Sao_Paulo';
const TODAY = '2026-11-15';

const makeSnapshot = (
  targets: number[],
  monthlyIncome: number | null = 1_000,
) => ({
  id: 'snapshot-1',
  workspaceId: WORKSPACE_ID,
  effectiveFrom: new Date('2026-11-01T03:00:00.000Z'),
  monthlyIncome,
  mode: 'fixed',
  allocations: targets.map((targetCents) => ({ targetCents })),
});

const makeLedgerMonth = (
  key: string,
  overrides: Partial<LedgerMonth> = {},
): LedgerMonth => ({
  key,
  totalIncome: 0,
  totalExpense: 0,
  pending: { totalIncome: 0, totalExpense: 0 },
  plainExpenses: [],
  ...overrides,
});

const plain = (day: number, amount: number, pending = false) => ({
  day,
  categoryId: 'cat-1',
  amount,
  pending,
});

const makeRentRule = (): RecurringRuleSnapshot => ({
  id: 'rent',
  type: 'EXPENSE',
  categoryId: null,
  amount: 300_000,
  frequency: RecurrenceFrequency.MONTHLY,
  interval: 1,
  startDate: new Date('2026-09-20T15:00:00.000Z'),
  endDate: null,
  lastGenerated: null,
  materializedDates: [],
});

describe('ResolveMonthPlanService', () => {
  let service: ResolveMonthPlanService;
  let budgetRepository: jest.Mocked<BudgetRepository>;
  let monthProjectionRepository: jest.Mocked<MonthProjectionRepository>;
  let dateProvider: DayJsDateProvider;

  beforeEach(() => {
    budgetRepository = {
      resolveSnapshot: jest.fn().mockResolvedValue(null),
      findCompletedExpenseByLocalDay: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BudgetRepository>;
    monthProjectionRepository = {
      findMonthLedger: jest.fn().mockResolvedValue([]),
      findActiveRecurringRules: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MonthProjectionRepository>;
    dateProvider = new DayJsDateProvider();

    service = new ResolveMonthPlanService(
      budgetRepository,
      monthProjectionRepository,
      {
        execute: jest.fn().mockResolvedValue(SAO_PAULO),
      } as unknown as GetWorkspaceTimezoneService,
      dateProvider,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const resolve = async (
    month = 11,
    year = 2026,
    today = TODAY,
  ): Promise<ResolvedMonthPlan> => {
    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      month,
      year,
      today,
    });
    if (result.isLeft()) throw result.value;
    return result.value;
  };

  const givenLedger = (...months: LedgerMonth[]) =>
    monthProjectionRepository.findMonthLedger.mockResolvedValue(months);

  it('declares the snapshot total without reading the ledger', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(
      makeSnapshot([700, 300]) as never,
    );

    const plan = await resolve();

    expect(plan).toEqual({ source: 'declared', planTotalCents: 1_000 });
    expect(monthProjectionRepository.findMonthLedger).not.toHaveBeenCalled();
  });

  it('declares a past month snapshot', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(
      makeSnapshot([500]) as never,
    );

    expect(await resolve(10)).toEqual({
      source: 'declared',
      planTotalCents: 500,
    });
  });

  it.each([10, 12])(
    'keeps month %s without a snapshot unplanned',
    async (month) => {
      givenLedger(
        makeLedgerMonth('2026-10', { plainExpenses: [plain(3, 1_000)] }),
      );

      expect(await resolve(month)).toEqual({ source: 'none' });
      expect(monthProjectionRepository.findMonthLedger).not.toHaveBeenCalled();
    },
  );

  it('has nothing observed with zero plain expenses and reports the bills due', async () => {
    monthProjectionRepository.findActiveRecurringRules.mockResolvedValue([
      makeRentRule(),
    ]);
    budgetRepository.findCompletedExpenseByLocalDay.mockResolvedValue([
      { day: 5, totalCents: 300_000 },
    ]);

    expect(await resolve()).toEqual({
      source: 'nothing-observed',
      recurringDueCents: 300_000,
      spentCents: 300_000,
    });
  });

  it('gives an initial figure from one expense on day 1', async () => {
    givenLedger(
      makeLedgerMonth('2026-11', { plainExpenses: [plain(1, 30_000)] }),
    );
    budgetRepository.findCompletedExpenseByLocalDay.mockResolvedValue([
      { day: 1, totalCents: 30_000 },
    ]);

    const plan = await resolve(11, 2026, '2026-11-01');

    expect(plan).toMatchObject({
      source: 'provisional',
      planTotalCents: 154_286,
      spentCents: 30_000,
      basis: { confidence: 'initial', frozen: false, dailyRateCents: 4_286 },
    });
  });

  it('treats a snapshot with income and no allocations as provisional', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(
      makeSnapshot([], 500_000) as never,
    );
    givenLedger(
      makeLedgerMonth('2026-11', { plainExpenses: [plain(14, 3_000)] }),
    );

    const plan = await resolve();

    expect(plan.source).toBe('provisional');
  });

  it('ignores pending rows when observing', async () => {
    givenLedger(
      makeLedgerMonth('2026-11', {
        plainExpenses: [plain(14, 3_000), plain(28, 9_000_000, true)],
      }),
    );

    const plan = await resolve();

    expect(plan).toMatchObject({
      source: 'provisional',
      basis: { activeDays: 1 },
    });
  });

  it('never reads income, so salary before signup gives the same figure', async () => {
    const plainExpenses = [plain(10, 3_000), plain(14, 5_000)];
    givenLedger(makeLedgerMonth('2026-11', { plainExpenses }));
    const withoutIncome = await resolve();

    givenLedger(
      makeLedgerMonth('2026-10', { totalIncome: 900_000_000 }),
      makeLedgerMonth('2026-11', { plainExpenses, totalIncome: 800_000_000 }),
    );
    const withIncome = await resolve();

    expect(withIncome).toEqual(withoutIncome);
  });

  it('freezes on the prior months and ignores the current month rate', async () => {
    const october = makeLedgerMonth('2026-10', {
      plainExpenses: [1, 2, 3, 4, 5, 6].map((day) => plain(day, 1_000)),
    });
    givenLedger(
      october,
      makeLedgerMonth('2026-11', { plainExpenses: [plain(14, 9_000_000)] }),
    );
    budgetRepository.findCompletedExpenseByLocalDay.mockResolvedValue([
      { day: 14, totalCents: 9_000_000 },
    ]);
    monthProjectionRepository.findActiveRecurringRules.mockResolvedValue([
      makeRentRule(),
    ]);

    const plan = await resolve();

    expect(plan).toMatchObject({
      source: 'provisional',
      planTotalCents: 300_000 + Math.round((6_000 / 31) * 30),
      basis: {
        frozen: true,
        confidence: 'observed',
        recurringExpenseCents: 300_000,
      },
    });
  });

  it('gives the same result on every run', async () => {
    givenLedger(
      makeLedgerMonth('2026-11', {
        plainExpenses: [plain(10, 3_000), plain(14, 5_000)],
      }),
    );

    expect(await resolve()).toEqual(await resolve());
  });

  describe('workspace local midnight', () => {
    it('is still October at 23:59 local on the last day', async () => {
      expect(await resolve(11, 2026, '2026-10-31')).toEqual({ source: 'none' });
    });

    it('is November from 00:00 local', async () => {
      expect(await resolve(11, 2026, '2026-11-01')).toMatchObject({
        source: 'nothing-observed',
      });
    });

    it('reads the ledger and spend with the workspace month bounds', async () => {
      await resolve();

      expect(
        budgetRepository.findCompletedExpenseByLocalDay,
      ).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        timezone: SAO_PAULO,
        start: new Date('2026-11-01T03:00:00.000Z'),
        end: new Date('2026-12-01T02:59:59.999Z'),
      });
      expect(monthProjectionRepository.findMonthLedger).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        timezone: SAO_PAULO,
        range: {
          start: new Date('2025-11-01T03:00:00.000Z'),
          end: new Date('2026-12-01T02:59:59.999Z'),
        },
        currentMonthStart: new Date('2026-11-01T03:00:00.000Z'),
      });
    });
  });
});
