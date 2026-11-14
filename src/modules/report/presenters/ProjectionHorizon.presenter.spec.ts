import { HorizonProjection } from '@modules/report/valueObjects/ProjectionHorizon';
import { toHTTPProjectionHorizon } from './ProjectionHorizon.presenter';

const projection: HorizonProjection = {
  openingBalanceCents: 100000,
  months: [
    {
      key: '2026-10',
      status: 'ok',
      inflowCents: 300000,
      outflowCents: 200000,
      netCents: 100000,
      shortfallCents: 0,
      endBalanceCents: 200000,
      sources: {
        realized: { totalIncome: 100000, totalExpense: 50000 },
        scheduled: { totalIncome: 0, totalExpense: 25000 },
        recurringNotYetGenerated: { totalIncome: 0, totalExpense: 15000 },
        fixedBillsDueCents: 0,
        variableRemainingCents: 110000,
      },
      pendingInstallments: [
        {
          date: '2026-10-20',
          amountCents: 25000,
          type: 'EXPENSE',
          recurringId: 'card-1',
          installmentNumber: 2,
          installmentCount: 6,
        },
      ],
      plan: {
        exists: true,
        monthlyIncomeCents: 400000,
        targetCents: 250000,
        mode: 'fixed',
      },
      hasHistory: true,
      basisMonths: 3,
    },
    {
      key: '2026-11',
      status: 'insufficient',
      inflowCents: 0,
      outflowCents: 0,
      netCents: 0,
      shortfallCents: 0,
      endBalanceCents: 200000,
      sources: {
        realized: { totalIncome: 0, totalExpense: 0 },
        scheduled: { totalIncome: 0, totalExpense: 0 },
        recurringNotYetGenerated: { totalIncome: 0, totalExpense: 0 },
        fixedBillsDueCents: 0,
        variableRemainingCents: 0,
      },
      pendingInstallments: [],
      plan: { exists: false },
      hasHistory: false,
      basisMonths: 0,
    },
  ],
};

describe('toHTTPProjectionHorizon', () => {
  it('converts cents to decimals and keeps the horizon echo', () => {
    const result = toHTTPProjectionHorizon({
      projection,
      horizon: 2,
      generatedAt: new Date('2026-10-15T12:00:00.000Z'),
    });

    expect(result.openingBalance).toBe(1000);
    expect(result.generatedAt).toBe('2026-10-15T12:00:00.000Z');
    expect(result.horizon).toBe(2);
    expect(result.months[0]).toEqual({
      key: '2026-10',
      status: 'ok',
      inflow: 3000,
      outflow: 2000,
      net: 1000,
      shortfall: 0,
      endBalance: 2000,
      sources: {
        realized: { totalIncome: 1000, totalExpense: 500 },
        scheduled: { totalIncome: 0, totalExpense: 250 },
        recurringNotYetGenerated: { totalIncome: 0, totalExpense: 150 },
        fixedBillsDue: 0,
        variableRemaining: 1100,
      },
      pendingInstallments: [
        {
          date: '2026-10-20',
          amount: 250,
          type: 'EXPENSE',
          recurringId: 'card-1',
          installmentNumber: 2,
          installmentCount: 6,
        },
      ],
      plan: {
        exists: true,
        monthlyIncome: 4000,
        target: 2500,
        mode: 'fixed',
      },
      hasHistory: true,
      basisMonths: 3,
    });
  });

  it('keeps a plan without income as a null monthlyIncome', () => {
    const result = toHTTPProjectionHorizon({
      projection: {
        ...projection,
        months: [
          {
            ...projection.months[0],
            plan: {
              exists: true,
              monthlyIncomeCents: null,
              targetCents: 250000,
              mode: 'fixed',
            },
          },
        ],
      },
      horizon: 1,
      generatedAt: new Date('2026-10-15T12:00:00.000Z'),
    });

    expect(result.months[0].plan).toEqual({
      exists: true,
      monthlyIncome: null,
      target: 2500,
      mode: 'fixed',
    });
  });

  it('keeps zeroed insufficient months as real zeros', () => {
    const result = toHTTPProjectionHorizon({
      projection,
      horizon: 2,
      generatedAt: new Date('2026-10-15T12:00:00.000Z'),
    });

    expect(result.months[1].plan).toEqual({ exists: false });
    expect(result.months[1].net).toBe(0);
    expect(result.months[1].shortfall).toBe(0);
    expect(result.months[1].pendingInstallments).toEqual([]);
  });
});
