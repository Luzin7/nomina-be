import {
  BudgetRepository,
  type InferenceMonthTotals,
} from '@modules/budget/repositories/contracts/BudgetRepository';
import { MonthProjectionRepository } from '@modules/report/repositories/contracts/MonthProjectionRepository';
import {
  MAX_BASIS_MONTHS,
  type LedgerMonth,
} from '@modules/report/valueObjects/ProjectionRules';
import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import { ResolveIncomePrefillService } from './resolve-income-prefill.service';

const WORKSPACE_ID = 'ws-1';
const TIMEZONE = 'America/Sao_Paulo';
const NOW = new Date('2026-11-15T12:00:00.000Z');
const CURRENT_MONTH_START = new Date('2026-11-01T03:00:00.000Z');
const LOOKBACK_START = new Date('2025-11-01T03:00:00.000Z');
const LOOKBACK_END = new Date('2026-11-01T02:59:59.999Z');

const makeLedgerMonth = (key: string, activeDays = 5): LedgerMonth => ({
  key,
  totalIncome: 0,
  totalExpense: 0,
  pending: { totalIncome: 0, totalExpense: 0 },
  completedCount: activeDays,
  plainExpenses: Array.from({ length: activeDays }, (_, index) => ({
    day: index + 1,
    categoryId: 'cat-1',
    amount: 1_000,
    pending: false,
  })),
});

const makeTotals = (
  month: string,
  incomeCents: number,
): InferenceMonthTotals => ({
  month,
  incomeCents,
  expenseByCategory: {},
});

const activeLedger = (keys: string[]): LedgerMonth[] =>
  keys.map((key) => makeLedgerMonth(key));

describe('ResolveIncomePrefillService', () => {
  let service: ResolveIncomePrefillService;
  let repository: jest.Mocked<BudgetRepository>;
  let monthProjection: jest.Mocked<MonthProjectionRepository>;

  beforeEach(() => {
    repository = {
      findRecurringMonthlyIncomeCents: jest.fn().mockResolvedValue(null),
      findInferenceTotals: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<BudgetRepository>;

    monthProjection = {
      findMonthLedger: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<MonthProjectionRepository>;

    const dateProvider = new DayJsDateProvider();
    jest.spyOn(dateProvider, 'now').mockReturnValue(NOW);

    service = new ResolveIncomePrefillService(
      repository,
      monthProjection,
      dateProvider,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the recurring sum when an active monthly income recurrence exists', async () => {
    repository.findRecurringMonthlyIncomeCents.mockResolvedValueOnce(850_000);

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      timezone: TIMEZONE,
    });

    expect(result).toEqual({ cents: 850_000, source: 'recurring' });
    expect(monthProjection.findMonthLedger).not.toHaveBeenCalled();
    expect(repository.findInferenceTotals).not.toHaveBeenCalled();
  });

  it('falls back to the inferred income when no recurrence exists', async () => {
    monthProjection.findMonthLedger.mockResolvedValueOnce(
      activeLedger(['2026-09', '2026-08', '2026-07']),
    );
    repository.findInferenceTotals.mockResolvedValueOnce([
      makeTotals('2026-09', 400_000),
      makeTotals('2026-08', 450_000),
      makeTotals('2026-07', 460_000),
    ]);

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      timezone: TIMEZONE,
    });

    expect(result).toEqual({ cents: 450_000, source: 'inferred' });
    expect(repository.findInferenceTotals).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      timezone: TIMEZONE,
      start: LOOKBACK_START,
      end: LOOKBACK_END,
    });
    expect(monthProjection.findMonthLedger).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      timezone: TIMEZONE,
      range: { start: LOOKBACK_START, end: LOOKBACK_END },
      currentMonthStart: CURRENT_MONTH_START,
    });
  });

  it('reports none when there is neither a recurrence nor an inference', async () => {
    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      timezone: TIMEZONE,
    });

    expect(result).toEqual({ cents: null, source: 'none' });
  });

  it('keeps a recurring sum even when it is below the inference', async () => {
    repository.findRecurringMonthlyIncomeCents.mockResolvedValueOnce(100_000);
    monthProjection.findMonthLedger.mockResolvedValueOnce(
      activeLedger(['2026-09', '2026-08', '2026-07']),
    );
    repository.findInferenceTotals.mockResolvedValueOnce([
      makeTotals('2026-09', 800_000),
      makeTotals('2026-08', 900_000),
      makeTotals('2026-07', 1_000_000),
    ]);

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      timezone: TIMEZONE,
    });

    expect(result).toEqual({ cents: 100_000, source: 'recurring' });
    expect(monthProjection.findMonthLedger).not.toHaveBeenCalled();
    expect(repository.findInferenceTotals).not.toHaveBeenCalled();
  });

  it('keeps a recurrence that sums to zero as a recurring prefill', async () => {
    repository.findRecurringMonthlyIncomeCents.mockResolvedValueOnce(0);

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      timezone: TIMEZONE,
    });

    expect(result).toEqual({ cents: 0, source: 'recurring' });
  });

  it('excludes a month below the minimum active days, as the engine does', async () => {
    monthProjection.findMonthLedger.mockResolvedValueOnce([
      makeLedgerMonth('2026-10'),
      makeLedgerMonth('2026-09'),
      makeLedgerMonth('2026-08'),
      makeLedgerMonth('2026-07', 4),
    ]);
    repository.findInferenceTotals.mockResolvedValueOnce([
      makeTotals('2026-10', 400_000),
      makeTotals('2026-09', 450_000),
      makeTotals('2026-08', 500_000),
      makeTotals('2026-07', 10_000_000),
    ]);

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      timezone: TIMEZONE,
    });

    expect(result).toEqual({ cents: 450_000, source: 'inferred' });
    expect(result.cents).not.toBe(475_000);
  });

  it('takes the same latest months as the engine when more than the maximum are active', async () => {
    const keys = [
      '2026-10',
      '2026-09',
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
    ];
    const incomes: Record<string, number> = {
      '2026-10': 700_000,
      '2026-09': 600_000,
      '2026-08': 500_000,
      '2026-07': 400_000,
      '2026-06': 300_000,
      '2026-05': 200_000,
      '2026-04': 100_000,
      '2026-03': 90_000,
    };
    monthProjection.findMonthLedger.mockResolvedValueOnce(activeLedger(keys));
    repository.findInferenceTotals.mockResolvedValueOnce(
      keys.map((key) => makeTotals(key, incomes[key])),
    );

    const result = await service.execute({
      workspaceId: WORKSPACE_ID,
      timezone: TIMEZONE,
    });

    expect(keys).toHaveLength(MAX_BASIS_MONTHS + 2);
    expect(result).toEqual({ cents: 450_000, source: 'inferred' });
    expect(result.cents).not.toBe(350_000);
  });
});
