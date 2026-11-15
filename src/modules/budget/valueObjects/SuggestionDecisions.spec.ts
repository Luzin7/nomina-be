import {
  resolveIncomeStatus,
  resolveSplitProgress,
  type SuggestionDecisionRecord,
} from './SuggestionDecisions';

function makeDecision(
  overrides: Partial<SuggestionDecisionRecord> = {},
): SuggestionDecisionRecord {
  return {
    kind: 'split',
    month: '2026-03',
    decision: 'accepted',
    incomeCents: null,
    bracketVersion: 1,
    ...overrides,
  };
}

describe('resolveIncomeStatus', () => {
  const base = {
    decisions: [],
    currentMonth: '2026-11',
    snapshotIncomeCents: null,
    inferredBaseCents: 500_000,
  };

  it('is pending when income is inferred and undecided', () => {
    expect(resolveIncomeStatus(base)).toBe('pending');
  });

  it('is unavailable without an inferred base', () => {
    expect(resolveIncomeStatus({ ...base, inferredBaseCents: null })).toBe(
      'unavailable',
    );
  });

  it('is set when the snapshot already has income', () => {
    expect(resolveIncomeStatus({ ...base, snapshotIncomeCents: 400_000 })).toBe(
      'set',
    );
  });

  it('is accepted when accepted in the current month', () => {
    const decisions = [
      makeDecision({ kind: 'income', month: '2026-11', incomeCents: 500_000 }),
    ];

    expect(
      resolveIncomeStatus({
        ...base,
        decisions,
        snapshotIncomeCents: 500_000,
      }),
    ).toBe('accepted');
  });

  it('stays rejected while the base is within 20% of the rejected value', () => {
    const decisions = [
      makeDecision({
        kind: 'income',
        month: '2026-09',
        decision: 'rejected',
        incomeCents: 420_000,
      }),
    ];

    expect(
      resolveIncomeStatus({ ...base, decisions, inferredBaseCents: 504_000 }),
    ).toBe('pending');
    expect(
      resolveIncomeStatus({ ...base, decisions, inferredBaseCents: 503_999 }),
    ).toBe('rejected');
  });

  it('measures the rejected distance against the latest rejection', () => {
    const decisions = [
      makeDecision({
        kind: 'income',
        month: '2026-05',
        decision: 'rejected',
        incomeCents: 100_000,
      }),
      makeDecision({
        kind: 'income',
        month: '2026-08',
        decision: 'rejected',
        incomeCents: 500_000,
      }),
    ];

    expect(resolveIncomeStatus({ ...base, decisions })).toBe('rejected');
  });

  it('ignores split decisions', () => {
    const decisions = [makeDecision({ decision: 'rejected' })];

    expect(resolveIncomeStatus({ ...base, decisions })).toBe('pending');
  });
});

describe('resolveSplitProgress', () => {
  const base = {
    decisions: [],
    currentMonth: '2026-11',
    hasIncomeBasis: true,
    steps: 6,
  };

  it('opens at step 1 without decisions', () => {
    expect(resolveSplitProgress(base)).toEqual({ status: 'open', step: 1 });
  });

  it.each([
    ['2026-10', 2],
    ['2026-09', 3],
    ['2026-06', 6],
    ['2026-01', 6],
  ])(
    'counts the step from the first income-based acceptance in %s',
    (month, step) => {
      const decisions = [makeDecision({ month })];

      expect(resolveSplitProgress({ ...base, decisions })).toEqual({
        status: 'open',
        step,
      });
    },
  );

  it('is accepted when accepted in the current month', () => {
    const decisions = [makeDecision({ month: '2026-11' })];

    expect(resolveSplitProgress({ ...base, decisions }).status).toBe(
      'accepted',
    );
  });

  it('skips only the current month after a glide-step rejection', () => {
    const decisions = [
      makeDecision({ month: '2026-09' }),
      makeDecision({ month: '2026-10', decision: 'rejected' }),
    ];

    expect(resolveSplitProgress({ ...base, decisions })).toEqual({
      status: 'open',
      step: 3,
    });
    expect(
      resolveSplitProgress({ ...base, decisions, currentMonth: '2026-10' })
        .status,
    ).toBe('rejected');
  });

  it('keeps an initial rejection final', () => {
    const decisions = [
      makeDecision({ month: '2026-08', decision: 'rejected' }),
    ];

    expect(resolveSplitProgress({ ...base, decisions }).status).toBe(
      'rejected',
    );
  });

  it('is complete once the last step was accepted', () => {
    const decisions = [
      makeDecision({ month: '2026-03' }),
      makeDecision({ month: '2026-08' }),
    ];

    expect(resolveSplitProgress({ ...base, decisions }).status).toBe(
      'complete',
    );
  });

  it('stays accepted after a no-income acceptance while income is still missing', () => {
    const decisions = [
      makeDecision({ month: '2026-08', bracketVersion: null }),
    ];

    expect(
      resolveSplitProgress({ ...base, decisions, hasIncomeBasis: false })
        .status,
    ).toBe('accepted');
  });

  it('restarts at step 1 when income arrives after a no-income acceptance', () => {
    const decisions = [
      makeDecision({ month: '2026-08', bracketVersion: null }),
    ];

    expect(resolveSplitProgress({ ...base, decisions })).toEqual({
      status: 'open',
      step: 1,
    });
  });
});
