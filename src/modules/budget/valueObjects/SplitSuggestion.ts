import { median } from '@utils/median';
import { presetWeightOf } from '@modules/budget/valueObjects/BudgetPreset';
import {
  GROUP_KEYS,
  type GroupKey,
  type ResolvedBracket,
} from '@modules/budget/valueObjects/IncomeBracket';

export type SuggestionCategory = {
  id: string;
  name: string;
  parentId: string | null;
  hidden: boolean;
};

export type SplitSuggestionInput = {
  categories: SuggestionCategory[];
  spendByMonth: Record<string, number>[];
  groupByCategoryName: Partial<Record<string, GroupKey>>;
  incomeBasisCents: number | null;
  bracket: ResolvedBracket | null;
  currentTargets: Record<string, number>;
  step: number;
  steps: number;
};

export type SuggestedAllocation = {
  categoryId: string;
  group: GroupKey | null;
  actualCents: number;
  idealCents: number | null;
  suggestedCents: number;
};

export type SplitSuggestion = {
  allocations: SuggestedAllocation[];
  unmappedCategoryIds: string[];
};

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

const CENTS_PER_REAL = 100;

const distribute = (totalUnits: number, weights: number[]): number[] => {
  const totalWeight = sum(weights);
  if (totalWeight === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (totalUnits * weight) / totalWeight);
  const shares = exact.map(Math.floor);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let left = totalUnits - sum(shares), at = 0; left > 0; left--, at++) {
    shares[byFraction[at % byFraction.length].index] += 1;
  }
  return shares;
};

const roundToReais = (cents: number): number =>
  Math.round(cents / CENTS_PER_REAL) * CENTS_PER_REAL;

const wholeReaisKeepingPositive = (cents: number, wasPositive: boolean) => {
  const rounded = roundToReais(cents);
  return wasPositive && rounded <= 0 ? CENTS_PER_REAL : rounded;
};

function actualByRoot(input: SplitSuggestionInput): Map<string, number> {
  const parentOf = new Map(
    input.categories.map((category) => [category.id, category.parentId]),
  );
  const monthly = input.spendByMonth.map((month) => {
    const rolled = new Map<string, number>();
    for (const [categoryId, cents] of Object.entries(month)) {
      const rootId = parentOf.get(categoryId) ?? categoryId;
      rolled.set(rootId, (rolled.get(rootId) ?? 0) + cents);
    }
    return rolled;
  });
  const rootIds = new Set(monthly.flatMap((month) => [...month.keys()]));
  return new Map(
    [...rootIds].map((rootId) => [
      rootId,
      Math.round(median(monthly.map((month) => month.get(rootId) ?? 0))),
    ]),
  );
}

type Candidate = {
  category: SuggestionCategory;
  group: GroupKey | null;
  actualCents: number;
};

function buildCandidates(input: SplitSuggestionInput): Candidate[] {
  const actuals = actualByRoot(input);
  const roots = input.categories.filter(
    (category) => category.parentId === null && !category.hidden,
  );
  const groupOf = (category: SuggestionCategory): GroupKey | null =>
    input.groupByCategoryName[category.name] ?? null;
  const spentGroups = new Set(
    roots
      .filter((category) => (actuals.get(category.id) ?? 0) > 0)
      .map(groupOf),
  );
  return roots
    .map((category) => ({
      category,
      group: groupOf(category),
      actualCents: actuals.get(category.id) ?? 0,
    }))
    .filter(
      (candidate) =>
        candidate.actualCents > 0 ||
        (candidate.group !== null && !spentGroups.has(candidate.group)),
    );
}

function idealByCategory(
  candidates: Candidate[],
  input: SplitSuggestionInput,
): Map<string, number> {
  const ideals = new Map<string, number>();
  if (input.incomeBasisCents === null || input.bracket === null) return ideals;
  const incomeReais = Math.floor(input.incomeBasisCents / CENTS_PER_REAL);
  const leftoverCents = input.incomeBasisCents % CENTS_PER_REAL;
  const groupReais = distribute(
    incomeReais,
    GROUP_KEYS.map((group) => input.bracket!.shares[group]),
  );
  GROUP_KEYS.forEach((group, groupIndex) => {
    const members = candidates.filter((candidate) => candidate.group === group);
    if (members.length === 0) return;
    const hasSpend = members.some((member) => member.actualCents > 0);
    const weights = members.map((member) =>
      hasSpend ? member.actualCents : presetWeightOf(member.category.name),
    );
    distribute(groupReais[groupIndex], weights).forEach((reais, index) =>
      ideals.set(members[index].category.id, reais * CENTS_PER_REAL),
    );
  });
  const largest = [...ideals.entries()].reduce<[string, number] | null>(
    (best, entry) => (best === null || entry[1] > best[1] ? entry : best),
    null,
  );
  if (largest !== null) ideals.set(largest[0], largest[1] + leftoverCents);
  return ideals;
}

const glide = (
  currentCents: number,
  idealCents: number,
  step: number,
  steps: number,
): number => {
  const remaining = steps - step + 1;
  if (remaining <= 1) return idealCents;
  return wholeReaisKeepingPositive(
    currentCents + (idealCents - currentCents) / remaining,
    currentCents > 0,
  );
};

export function buildSplitSuggestion(
  input: SplitSuggestionInput,
): SplitSuggestion {
  const eligible = buildCandidates(input);
  const ideals = idealByCategory(eligible, input);
  const candidates = eligible.filter(
    (candidate) =>
      candidate.actualCents > 0 || ideals.has(candidate.category.id),
  );
  const allocations = candidates.map(({ category, group, actualCents }) => {
    const idealCents = ideals.get(category.id) ?? null;
    const currentCents = input.currentTargets[category.id] ?? actualCents;
    return {
      categoryId: category.id,
      group,
      actualCents,
      idealCents,
      suggestedCents:
        idealCents === null
          ? wholeReaisKeepingPositive(actualCents, actualCents > 0)
          : glide(currentCents, idealCents, input.step, input.steps),
    };
  });
  return {
    allocations,
    unmappedCategoryIds: candidates
      .filter((candidate) => candidate.group === null)
      .map((candidate) => candidate.category.id),
  };
}
