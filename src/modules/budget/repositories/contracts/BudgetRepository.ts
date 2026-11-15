import { type BudgetMode } from '@constants/enums';
import type { SuggestionCategory } from '@modules/budget/valueObjects/SplitSuggestion';
import type {
  GroupKey,
  IncomeBracketRow,
} from '@modules/budget/valueObjects/IncomeBracket';
import type { SuggestionDecisionRecord } from '@modules/budget/valueObjects/SuggestionDecisions';

export type BudgetCategoryRef = {
  id: string;
  name: string;
  workspaceId: string | null;
  isHidden: boolean;
};

export type BudgetAllocationRecord = {
  id: string;
  categoryId: string;
  categoryName: string | null;
  groupName: string;
  groupOrder: number;
  categoryOrder: number;
  percentageOfIncome: number | null;
  targetCents: number;
};

export type BudgetSnapshot = {
  id: string;
  workspaceId: string;
  effectiveFrom: Date;
  monthlyIncome: number | null;
  mode: BudgetMode;
  allocations: BudgetAllocationRecord[];
};

export type SaveBudgetAllocationInput = Omit<
  BudgetAllocationRecord,
  'id' | 'categoryName'
>;

export type SaveBudgetSnapshotInput = {
  workspaceId: string;
  effectiveFrom: Date;
  monthlyIncome: number | null;
  mode: BudgetMode;
  allocations: SaveBudgetAllocationInput[];
};

export type SavedBudgetSnapshot = {
  id: string;
  effectiveFrom: Date;
};

export type BudgetSnapshotTarget = {
  monthlyIncomeCents: number | null;
  targetCents: number;
  mode: BudgetMode;
};

export type ResolvedBudgetSnapshot = {
  monthStart: Date;
  snapshot: BudgetSnapshotTarget | null;
};

export type PresetCategory = {
  id: string;
  name: string;
};

export type CompletedExpenseByLocalDayQuery = {
  workspaceId: string;
  start: Date;
  end: Date;
  timezone: string;
};

export type CompletedExpenseOfDay = { day: number; totalCents: number };

export type InferenceTotalsQuery = {
  workspaceId: string;
  start: Date;
  end: Date;
  timezone: string;
};

export type InferenceMonthTotals = {
  month: string;
  incomeCents: number;
  expenseByCategory: Record<string, number>;
};

export type SuggestionParameters = {
  minimumWage: { valueCents: number; effectiveFrom: string } | null;
  bracketVersion: number | null;
  bracketRows: IncomeBracketRow[];
  groupByCategoryName: Partial<Record<string, GroupKey>>;
};

export type SuggestionDecisionInput = SuggestionDecisionRecord & {
  workspaceId: string;
};

export type SuggestedAllocationInput = Pick<
  SaveBudgetAllocationInput,
  'categoryId' | 'groupName' | 'groupOrder' | 'categoryOrder' | 'targetCents'
>;

export type SuggestionSnapshotWrite =
  | { kind: 'income'; monthlyIncome: number }
  | { kind: 'split'; allocations: SuggestedAllocationInput[] };

export type SaveSnapshotWithDecisionInput = {
  workspaceId: string;
  effectiveFrom: Date;
  expectedMonthlyIncome: number | null;
  decision: SuggestionDecisionInput;
  write: SuggestionSnapshotWrite;
  isStillCurrent: () => Promise<boolean>;
};

export type SuggestionWriteOutcome = 'applied' | 'already-decided' | 'drifted';

export abstract class BudgetRepository {
  abstract resolveSnapshot(
    workspaceId: string,
    monthStart: Date,
  ): Promise<BudgetSnapshot | null>;

  abstract resolveSnapshots(
    workspaceId: string,
    monthStarts: Date[],
  ): Promise<ResolvedBudgetSnapshot[]>;

  abstract findCategoriesByIds(
    categoryIds: string[],
  ): Promise<BudgetCategoryRef[]>;

  abstract findCompletedExpenseByCategory(
    workspaceId: string,
    start: Date,
    end: Date,
  ): Promise<Record<string, number>>;

  abstract findCompletedExpenseByLocalDay(
    query: CompletedExpenseByLocalDayQuery,
  ): Promise<CompletedExpenseOfDay[]>;

  abstract findCategoryParentMap(
    workspaceId: string,
  ): Promise<Record<string, string | null>>;

  abstract saveSnapshot(
    input: SaveBudgetSnapshotInput,
  ): Promise<SavedBudgetSnapshot>;

  abstract findMonthlyIncomeSuggestion(workspaceId: string): Promise<number>;

  abstract findPresetCategories(workspaceId: string): Promise<PresetCategory[]>;

  abstract findInferenceTotals(
    query: InferenceTotalsQuery,
  ): Promise<InferenceMonthTotals[]>;

  abstract findSuggestionCategories(
    workspaceId: string,
  ): Promise<SuggestionCategory[]>;

  abstract findSuggestionParameters(
    asOf: string,
  ): Promise<SuggestionParameters>;

  abstract findSuggestionDecisions(
    workspaceId: string,
  ): Promise<SuggestionDecisionRecord[]>;

  abstract saveSnapshotWithDecision(
    input: SaveSnapshotWithDecisionInput,
  ): Promise<SuggestionWriteOutcome>;

  abstract saveDecision(
    input: SuggestionDecisionInput,
  ): Promise<SuggestionWriteOutcome>;
}
