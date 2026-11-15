import { Goal } from './Goal';
import { InvalidGoalNameError } from '../errors';
import { makeGoalRecord } from '../test-helpers/goal-factories';

describe('Goal', () => {
  describe('normalizeName', () => {
    it('trims the name', () => {
      const name = Goal.normalizeName('  Viagem  ');

      expect(name.value).toBe('Viagem');
    });

    it('rejects a name that is empty after trim', () => {
      const name = Goal.normalizeName('   ');

      expect(name.isLeft()).toBe(true);
      expect(name.value).toBeInstanceOf(InvalidGoalNameError);
    });

    it('rejects a name longer than 60 characters', () => {
      const name = Goal.normalizeName('a'.repeat(61));

      expect(name.isLeft()).toBe(true);
    });

    it('accepts a name with exactly 60 characters', () => {
      const name = Goal.normalizeName('a'.repeat(60));

      expect(name.isRight()).toBe(true);
    });
  });

  describe('derived state', () => {
    it('reports an unconfigured goal without progress or remaining amount', () => {
      const goal = Goal.fromRecord(
        makeGoalRecord({
          targetCents: 0,
          currentCents: 50_000,
          monthlyAporteCents: 10_000,
        }),
      );

      expect(goal.configured).toBe(false);
      expect(goal.remainingCents).toBeNull();
      expect(goal.progressPercent).toBeNull();
      expect(goal.reached).toBe(false);
      expect(goal.etaMonths).toBeNull();
    });

    it('clamps the progress of an over-funded goal at 100', () => {
      const goal = Goal.fromRecord(
        makeGoalRecord({ targetCents: 100_000, currentCents: 150_000 }),
      );

      expect(goal.progressPercent).toBe(100);
      expect(goal.remainingCents).toBe(-50_000);
      expect(goal.reached).toBe(true);
    });
  });
});
