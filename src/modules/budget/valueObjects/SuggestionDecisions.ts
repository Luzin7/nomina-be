export type SuggestionKind = 'income' | 'split';

export type SuggestionDecisionRecord = {
  kind: SuggestionKind;
  month: string;
  decision: 'accepted' | 'rejected';
  incomeCents: number | null;
  bracketVersion: number | null;
};

export type IncomeStatus =
  | 'accepted'
  | 'rejected'
  | 'set'
  | 'unavailable'
  | 'pending';

export type SplitProgress =
  | { status: 'accepted' | 'rejected' | 'complete'; step: number }
  | { status: 'open'; step: number };

type ResolveIncomeStatusInput = {
  decisions: SuggestionDecisionRecord[];
  currentMonth: string;
  snapshotIncomeCents: number | null;
  inferredBaseCents: number | null;
};

type ResolveSplitProgressInput = {
  decisions: SuggestionDecisionRecord[];
  currentMonth: string;
  hasIncomeBasis: boolean;
  steps: number;
};

const REJECTION_REOPEN_RATIO = 0.2;

const monthIndex = (month: string): number => {
  const [year, number] = month.split('-').map(Number);
  return year * 12 + number - 1;
};

const ofKind = (
  decisions: SuggestionDecisionRecord[],
  kind: SuggestionKind,
): SuggestionDecisionRecord[] =>
  decisions
    .filter((decision) => decision.kind === kind)
    .sort((a, b) => monthIndex(a.month) - monthIndex(b.month));

const isIncomeBased = (decision: SuggestionDecisionRecord): boolean =>
  decision.decision === 'accepted' && decision.bracketVersion !== null;

const hasMovedEnough = (baseCents: number, rejectedCents: number): boolean =>
  Math.abs(baseCents - rejectedCents) >= REJECTION_REOPEN_RATIO * rejectedCents;

export function resolveIncomeStatus({
  decisions,
  currentMonth,
  snapshotIncomeCents,
  inferredBaseCents,
}: ResolveIncomeStatusInput): IncomeStatus {
  const incomeDecisions = ofKind(decisions, 'income');
  const thisMonth = incomeDecisions.find(
    (decision) => decision.month === currentMonth,
  );
  if (thisMonth?.decision === 'accepted') return 'accepted';
  if (snapshotIncomeCents !== null) return 'set';
  if (inferredBaseCents === null) return 'unavailable';

  const lastRejection = incomeDecisions
    .filter((decision) => decision.decision === 'rejected')
    .at(-1);
  if (!lastRejection || lastRejection.incomeCents === null) return 'pending';

  return hasMovedEnough(inferredBaseCents, lastRejection.incomeCents)
    ? 'pending'
    : 'rejected';
}

export function resolveSplitProgress({
  decisions,
  currentMonth,
  hasIncomeBasis,
  steps,
}: ResolveSplitProgressInput): SplitProgress {
  const splitDecisions = ofKind(decisions, 'split');
  const current = monthIndex(currentMonth);
  const thisMonth = splitDecisions.find(
    (decision) => decision.month === currentMonth,
  );
  const first = splitDecisions.find(isIncomeBased);
  const step = first
    ? Math.min(steps, current - monthIndex(first.month) + 1)
    : 1;

  if (thisMonth) return { status: thisMonth.decision, step };

  const lastStepAccepted = splitDecisions
    .filter(isIncomeBased)
    .some(
      (decision) =>
        first &&
        monthIndex(decision.month) - monthIndex(first.month) + 1 >= steps,
    );
  if (lastStepAccepted) return { status: 'complete', step };
  if (first) return { status: 'open', step };

  const finalRejection = splitDecisions.some(
    (decision) => decision.decision === 'rejected',
  );
  if (finalRejection) return { status: 'rejected', step };

  const acceptedWithoutIncome = splitDecisions.length > 0;
  if (acceptedWithoutIncome && !hasIncomeBasis) {
    return { status: 'accepted', step };
  }

  return { status: 'open', step };
}

export type SuggestionDecisionOutcome = {
  kind: SuggestionKind;
  status: 'accepted' | 'rejected';
  month: string;
};
