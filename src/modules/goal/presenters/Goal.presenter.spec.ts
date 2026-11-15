import { Goal } from '@modules/goal/entities/Goal';
import { makeGoalRecord } from '@modules/goal/test-helpers/goal-factories';
import { GoalPresenter } from './Goal.presenter';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const TIMEZONE = 'America/Sao_Paulo';

function present(record = makeGoalRecord()) {
  return GoalPresenter.toHTTP(Goal.fromRecord(record), {
    now: NOW,
    timezone: TIMEZONE,
  });
}

describe('GoalPresenter', () => {
  describe('etaMonths', () => {
    it('rounds up the months needed to reach the target', () => {
      const goal = present(
        makeGoalRecord({
          targetCents: 600_000,
          currentCents: 0,
          monthlyAporteCents: 100_000,
        }),
      );

      expect(goal.etaMonths).toBe(6);
      expect(goal.etaMonth).toBe('2027-05');
    });

    it('rounds up a partial month', () => {
      const goal = present(
        makeGoalRecord({
          targetCents: 600_000,
          currentCents: 0,
          monthlyAporteCents: 90_000,
        }),
      );

      expect(goal.etaMonths).toBe(7);
    });

    it('is null when no aporte was defined', () => {
      const goal = present(
        makeGoalRecord({
          targetCents: 600_000,
          currentCents: 0,
          monthlyAporteCents: 0,
        }),
      );

      expect(goal.etaMonths).toBeNull();
      expect(goal.etaMonth).toBeNull();
    });

    it('is null when the target was already reached', () => {
      const goal = present(
        makeGoalRecord({
          targetCents: 600_000,
          currentCents: 600_000,
          monthlyAporteCents: 100_000,
        }),
      );

      expect(goal.etaMonths).toBeNull();
      expect(goal.etaMonth).toBeNull();
      expect(goal.reached).toBe(true);
    });

    it('is null and unconfigured when the target is zero', () => {
      const goal = present(
        makeGoalRecord({
          targetCents: 0,
          currentCents: 0,
          monthlyAporteCents: 100_000,
        }),
      );

      expect(goal.configured).toBe(false);
      expect(goal.etaMonths).toBeNull();
      expect(goal.etaMonth).toBeNull();
    });
  });

  it('derives every field of an unconfigured goal', () => {
    const goal = present(
      makeGoalRecord({
        targetCents: 0,
        currentCents: 0,
        monthlyAporteCents: 0,
        isEmergency: true,
        isSystem: true,
      }),
    );

    expect(goal).toEqual({
      id: 'goal-1',
      name: 'Viagem',
      targetCents: 0,
      configured: false,
      currentCents: 0,
      monthlyAporteCents: 0,
      linkedAccountId: null,
      categoryId: null,
      isEmergency: true,
      isSystem: true,
      dismissedAt: null,
      remainingCents: null,
      progressPercent: null,
      reached: false,
      etaMonths: null,
      etaMonth: null,
    });
  });

  it('rounds progress and keeps the remaining amount', () => {
    const goal = present(
      makeGoalRecord({ targetCents: 300_000, currentCents: 100_000 }),
    );

    expect(goal.configured).toBe(true);
    expect(goal.progressPercent).toBe(33);
    expect(goal.remainingCents).toBe(200_000);
  });

  it('serializes the dismissal as an ISO string', () => {
    const goal = present(
      makeGoalRecord({ dismissedAt: new Date('2026-11-05T09:30:00.000Z') }),
    );

    expect(goal.dismissedAt).toBe('2026-11-05T09:30:00.000Z');
  });

  it('adds calendar months in the workspace timezone', () => {
    const goal = GoalPresenter.toHTTP(
      Goal.fromRecord(
        makeGoalRecord({
          targetCents: 600_000,
          currentCents: 0,
          monthlyAporteCents: 100_000,
        }),
      ),
      { now: new Date('2027-01-01T01:00:00.000Z'), timezone: TIMEZONE },
    );

    expect(goal.etaMonth).toBe('2027-06');
  });
});
