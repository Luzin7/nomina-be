import { GoalsSummaryPresenter } from './GoalsSummary.presenter';

describe('GoalsSummaryPresenter', () => {
  it('keeps every summary field of the contract', () => {
    const summary = GoalsSummaryPresenter.toHTTP({
      monthlyAporteCents: 300,
      totalTargetCents: 1_000,
      totalCurrentCents: 250,
      activeCount: 2,
      completedCount: 1,
      unsetTargetCount: 1,
    });

    expect(summary).toEqual({
      monthlyAporteCents: 300,
      totalTargetCents: 1_000,
      totalCurrentCents: 250,
      activeCount: 2,
      completedCount: 1,
      unsetTargetCount: 1,
    });
  });
});
