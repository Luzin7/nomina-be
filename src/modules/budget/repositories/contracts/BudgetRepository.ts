import { type BudgetMode } from '@constants/enums';

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
  monthlyIncome: number;
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
}
