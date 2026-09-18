import { DayJsDateProvider } from '@providers/date/implementations/Dayjs';
import {
  buildDailySummary,
  calculateNetPeriodEffect,
  resolveGeneralType,
  resolveInvestmentType,
  type PeriodRow,
} from './get-balance-evolution.handler';

const dateProvider = new DayJsDateProvider();
const START = new Date('2026-09-01T00:00:00.000Z');
const END = new Date('2026-09-02T23:59:59.999Z');

describe('resolveGeneralType', () => {
  it('classifies invoice payment as expense', () => {
    expect(resolveGeneralType('TRANSFER', 'CHECKING', 'CREDIT_CARD')).toBe(
      'EXPENSE',
    );
  });

  it('classifies transfer to investment as expense', () => {
    expect(resolveGeneralType('TRANSFER', 'CHECKING', 'INVESTMENT')).toBe(
      'EXPENSE',
    );
  });

  it('classifies transfer from investment as income', () => {
    expect(resolveGeneralType('TRANSFER', 'INVESTMENT', 'CHECKING')).toBe(
      'INCOME',
    );
  });

  it('keeps unrelated transfers untouched', () => {
    expect(resolveGeneralType('TRANSFER', 'CHECKING', 'CHECKING')).toBe(
      'TRANSFER',
    );
  });
});

describe('resolveInvestmentType', () => {
  it('classifies transfer to investment as income', () => {
    expect(resolveInvestmentType('TRANSFER', 'CHECKING', 'INVESTMENT')).toBe(
      'INCOME',
    );
  });

  it('classifies transfer from investment as expense', () => {
    expect(resolveInvestmentType('TRANSFER', 'INVESTMENT', 'CHECKING')).toBe(
      'EXPENSE',
    );
  });
});

describe('calculateNetPeriodEffect', () => {
  it('nets income minus expense', () => {
    const period: PeriodRow[] = [
      {
        type: 'INCOME',
        sourceType: 'CHECKING',
        destType: null,
        amount: 5000,
        date: START,
      },
      {
        type: 'EXPENSE',
        sourceType: 'CHECKING',
        destType: null,
        amount: 2000,
        date: START,
      },
    ];

    expect(calculateNetPeriodEffect(period, resolveGeneralType)).toBe(3000);
  });
});

describe('buildDailySummary', () => {
  it('applies opening balance and accumulates period movement per day', () => {
    const result = buildDailySummary({
      opening: [
        {
          type: 'EXPENSE',
          sourceType: 'CHECKING',
          destType: null,
          amount: 1000,
        },
      ],
      period: [
        {
          type: 'INCOME',
          sourceType: 'CHECKING',
          destType: null,
          amount: 5000,
          date: new Date('2026-09-01T12:00:00.000Z'),
        },
        {
          type: 'EXPENSE',
          sourceType: 'CHECKING',
          destType: null,
          amount: 2000,
          date: new Date('2026-09-02T12:00:00.000Z'),
        },
      ],
      resolve: resolveGeneralType,
      dateProvider,
      timezone: 'UTC',
      startDate: START,
      endDate: END,
    });

    expect(result).toEqual([
      { date: '2026-09-01', income: 50, expense: 0, balance: 40 },
      { date: '2026-09-02', income: 0, expense: 20, balance: 20 },
    ]);
  });

  it('ignores opening balance when explicit start balance is provided', () => {
    const result = buildDailySummary({
      opening: [
        {
          type: 'EXPENSE',
          sourceType: 'CHECKING',
          destType: null,
          amount: 9999,
        },
      ],
      period: [],
      resolve: resolveGeneralType,
      dateProvider,
      timezone: 'UTC',
      startDate: START,
      endDate: START,
      explicitStartBalance: 100,
    });

    expect(result).toEqual([
      { date: '2026-09-01', income: 0, expense: 0, balance: 1 },
    ]);
  });
});
