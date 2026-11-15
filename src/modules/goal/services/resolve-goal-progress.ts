import { GoalProgressSource } from '@constants/enums';
import {
  GoalAccountSourceRequiresLinkError,
  GoalCurrentTracksAccountError,
} from '@modules/goal/errors';
import type { GoalRecord } from '@modules/goal/repositories/contracts/GoalRepository';

export type GoalProgressPatch = {
  progressSource: GoalProgressSource;
  currentCents?: number;
};

type ProgressRequest = {
  progressSource?: GoalProgressSource;
  linkedAccountId?: string | null;
  currentCents?: number;
};

export function validateNewGoalProgress(
  request: ProgressRequest,
): Error | null {
  if (request.progressSource !== GoalProgressSource.ACCOUNT) return null;
  if (!request.linkedAccountId) return new GoalAccountSourceRequiresLinkError();
  if (request.currentCents !== undefined) {
    return new GoalCurrentTracksAccountError();
  }

  return null;
}

export function resolveGoalProgress(
  current: GoalRecord,
  request: ProgressRequest,
): GoalProgressPatch | Error {
  const linkedAccountId =
    request.linkedAccountId === undefined
      ? current.linkedAccountId
      : request.linkedAccountId;
  const progressSource =
    request.progressSource ??
    (linkedAccountId === null
      ? GoalProgressSource.MANUAL
      : current.progressSource);

  if (progressSource === GoalProgressSource.ACCOUNT) {
    if (linkedAccountId === null)
      return new GoalAccountSourceRequiresLinkError();
    if (request.currentCents !== undefined) {
      return new GoalCurrentTracksAccountError();
    }

    return { progressSource };
  }

  return { progressSource, currentCents: manualCurrentCents(current, request) };
}

function manualCurrentCents(
  current: GoalRecord,
  request: ProgressRequest,
): number | undefined {
  if (request.currentCents !== undefined) return request.currentCents;
  if (current.progressSource !== GoalProgressSource.ACCOUNT) return undefined;

  return Math.max(0, current.linkedAccountBalanceCents ?? current.currentCents);
}
