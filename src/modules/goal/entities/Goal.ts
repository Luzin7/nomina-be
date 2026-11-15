import type { GoalRecord } from '@modules/goal/repositories/contracts/GoalRepository';
import { Either, left, right } from '@shared/core/errors/Either';
import { InvalidGoalNameError } from '../errors';

export const GOAL_NAME_MAX_LENGTH = 60;

export class Goal {
  private constructor(private readonly source: GoalRecord) {}

  static fromRecord(record: GoalRecord): Goal {
    return new Goal(record);
  }

  static normalizeName(name: string): Either<Error, string> {
    const trimmed = name.trim();

    if (trimmed.length === 0 || trimmed.length > GOAL_NAME_MAX_LENGTH) {
      return left(new InvalidGoalNameError());
    }

    return right(trimmed);
  }

  get record(): GoalRecord {
    return this.source;
  }

  get configured(): boolean {
    return this.record.targetCents > 0;
  }

  get remainingCents(): number | null {
    if (!this.configured) return null;

    return this.record.targetCents - this.record.currentCents;
  }

  get reached(): boolean {
    return (
      this.configured && this.record.currentCents >= this.record.targetCents
    );
  }

  get progressPercent(): number | null {
    if (!this.configured) return null;

    return Math.min(
      100,
      Math.round((this.record.currentCents / this.record.targetCents) * 100),
    );
  }

  get etaMonths(): number | null {
    const remaining = this.remainingCents;
    if (remaining === null || remaining <= 0) return null;
    if (this.record.monthlyAporteCents <= 0) return null;

    return Math.ceil(remaining / this.record.monthlyAporteCents);
  }
}
