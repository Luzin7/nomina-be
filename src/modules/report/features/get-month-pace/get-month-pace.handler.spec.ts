import { RecurrenceFrequency } from '@constants/enums';
import { BudgetRepository } from '@modules/budget/repositories/contracts/BudgetRepository';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import { RecurringRuleSnapshot } from '@modules/report/valueObjects/MonthProjection';
import { GetWorkspaceTimezoneService } from '@modules/workspace/services/get-workspace-timezone.service';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { LEDGER_LIVE_CACHE_TTL_SECONDS } from '@shared/cache/report-cache';
import { InMemoryCacheProvider } from '@shared/cache/test-helpers/in-memory-cache';
import { GetMonthPaceService } from './get-month-pace.handler';

const WORKSPACE_ID = 'ws-1';
const SAO_PAULO = 'America/Sao_Paulo';
const NOW = new Date('2026-11-15T15:00:00.000Z');

function makeSnapshot(totalTargetCents: number) {
  return {
    id: 'snapshot-1',
    workspaceId: WORKSPACE_ID,
    effectiveFrom: new Date('2026-11-01T03:00:00.000Z'),
    monthlyIncome: 1_000_000,
    mode: 'fixed',
    allocations: [
      { targetCents: totalTargetCents - 100 },
      { targetCents: 100 },
    ],
  };
}

function makeRentRule(): RecurringRuleSnapshot {
  return {
    id: 'rent',
    type: 'EXPENSE',
    categoryId: null,
    amount: 300_000,
    frequency: RecurrenceFrequency.MONTHLY,
    interval: 1,
    startDate: new Date('2026-09-05T15:00:00.000Z'),
    endDate: null,
    lastGenerated: null,
    materializedDates: [],
  };
}

describe('GetMonthPaceService', () => {
  let service: GetMonthPaceService;
  let budgetRepository: jest.Mocked<BudgetRepository>;
  let monthProjectionRepository: jest.Mocked<MonthProjectionRepository>;
  let workspaceTimezone: jest.Mocked<GetWorkspaceTimezoneService>;
  let dateProvider: DateProvider;
  let cache: InMemoryCacheProvider;

  beforeEach(() => {
    budgetRepository = {
      resolveSnapshot: jest.fn().mockResolvedValue(makeSnapshot(876_000)),
      findCompletedExpenseByLocalDay: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BudgetRepository>;
    monthProjectionRepository = {
      findActiveRecurringRules: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MonthProjectionRepository>;
    workspaceTimezone = {
      execute: jest.fn().mockResolvedValue(SAO_PAULO),
    } as unknown as jest.Mocked<GetWorkspaceTimezoneService>;
    dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);
    cache = new InMemoryCacheProvider();

    service = new GetMonthPaceService(
      budgetRepository,
      monthProjectionRepository,
      workspaceTimezone,
      dateProvider,
      cache,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  async function run(month = 11, year = 2026) {
    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      month,
      year,
    });
    if (result.isLeft()) throw result.value;
    return result.value;
  }

  it('returns daysInMonth days with spentCents null after today', async () => {
    const pace = await run();

    expect(pace.month).toBe('2026-11');
    expect(pace.daysInMonth).toBe(30);
    expect(pace.today).toBe(15);
    expect(pace.days).toHaveLength(30);
    expect(pace.days[14].spentCents).not.toBeNull();
    expect(pace.days[15].spentCents).toBeNull();
  });

  it('ends the plan at planTotalCents', async () => {
    const pace = await run();

    expect(pace.planTotalCents).toBe(876_000);
    expect(pace.days[29].planCents).toBe(876_000);
  });

  it('nulls the plan fields when there is no budget snapshot', async () => {
    budgetRepository.resolveSnapshot.mockResolvedValue(null);

    const pace = await run();

    expect(pace.planTotalCents).toBeNull();
    expect(pace.days.every((entry) => entry.planCents === null)).toBe(true);
  });

  it('makes the plan jump on the day of a rent rule', async () => {
    monthProjectionRepository.findActiveRecurringRules.mockResolvedValue([
      makeRentRule(),
    ]);

    const pace = await run();

    expect(pace.days[4].planCents! - pace.days[3].planCents!).toBeGreaterThan(
      300_000,
    );
    expect(pace.days[5].planCents! - pace.days[4].planCents!).toBeLessThan(
      30_000,
    );
  });

  it('sets today to the last day in a past month', async () => {
    const pace = await run(10);

    expect(pace.today).toBe(31);
    expect(pace.days[30].spentCents).toBe(0);
  });

  it('sets today to zero in a future month', async () => {
    const pace = await run(12);

    expect(pace.today).toBe(0);
    expect(pace.days.every((entry) => entry.spentCents === null)).toBe(true);
  });

  it('uses the workspace timezone for today', async () => {
    jest
      .spyOn(dateProvider, 'now')
      .mockReturnValue(new Date('2026-12-01T02:30:00.000Z'));

    const pace = await run(11);

    expect(pace.today).toBe(30);
  });

  it('counts spend by workspace-local day', async () => {
    budgetRepository.findCompletedExpenseByLocalDay.mockResolvedValue([
      { day: 14, totalCents: 700 },
      { day: 15, totalCents: 300 },
    ]);

    const pace = await run();

    expect(pace.days[13].spentCents).toBe(700);
    expect(pace.days[14].spentCents).toBe(1_000);
  });

  it('reads the month bounds in the workspace timezone', async () => {
    await run();

    expect(
      budgetRepository.findCompletedExpenseByLocalDay,
    ).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      timezone: SAO_PAULO,
      start: new Date('2026-11-01T03:00:00.000Z'),
      end: new Date('2026-12-01T02:59:59.999Z'),
    });
  });

  it('serves the second call from the cache with the live ttl', async () => {
    await run();
    await run();

    expect(budgetRepository.resolveSnapshot).toHaveBeenCalledTimes(1);
    expect([...cache.ttls.values()]).toEqual([LEDGER_LIVE_CACHE_TTL_SECONDS]);
  });

  it('keys the cache by ledger generation, month and local day', async () => {
    await run();

    expect([...cache.values.keys()]).toEqual([
      expect.stringMatching(
        /^report:month-pace:v1:ws-1:g\d+:2026-11:2026-11-15$/,
      ),
    ]);
  });

  it('recomputes after the ledger generation moves', async () => {
    await run();
    await cache.incrementCounter('cache-gen:report:ws-1', Date.now());
    await run();

    expect(budgetRepository.resolveSnapshot).toHaveBeenCalledTimes(2);
  });
});
