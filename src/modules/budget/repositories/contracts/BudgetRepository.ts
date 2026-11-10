import { type BudgetMode } from '@constants/enums';

export type BudgetCategoryRef = {
  id: string;
  name: string;
  workspaceId: string | null;
};

export type BudgetAllocationRecord = {
  id: string;
  categoryId: string;
  categoryName: string | null;
  groupName: string;
  groupOrder: number;
  categoryOrder: number;
  percentageOfIncome: number;
  targetCents: number;
};

export type BudgetSnapshot = {
  id: string;
  workspaceId: string;
  effectiveFrom: Date;
  monthlyIncome: number;
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

export type PresetCategory = {
  id: string;
  name: string;
};

export abstract class BudgetRepository {
  abstract resolveSnapshot(
    workspaceId: string,
    monthStart: Date,
  ): Promise<BudgetSnapshot | null>;

  abstract findCategoriesByIds(
    categoryIds: string[],
  ): Promise<BudgetCategoryRef[]>;

  abstract findCompletedExpenseByCategory(
    workspaceId: string,
    start: Date,
    end: Date,
  ): Promise<Record<string, number>>;

  abstract findCategoryParentMap(
    workspaceId: string,
  ): Promise<Record<string, string | null>>;

  abstract saveSnapshot(
    input: SaveBudgetSnapshotInput,
  ): Promise<SavedBudgetSnapshot>;

  abstract findMonthlyIncomeSuggestion(workspaceId: string): Promise<number>;

  abstract findPresetCategories(workspaceId: string): Promise<PresetCategory[]>;
}
