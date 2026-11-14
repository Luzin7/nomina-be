import type { SuggestedAllocationInput } from '@modules/budget/repositories/contracts/BudgetRepository';
import {
  GROUP_KEYS,
  type GroupKey,
} from '@modules/budget/valueObjects/IncomeBracket';
import type { SuggestedAllocation } from '@modules/budget/valueObjects/SplitSuggestion';

const UNGROUPED_NAME = 'Sem grupo';

const GROUP_NAMES: Record<GroupKey, string> = {
  essentials: 'Essenciais',
  lifestyle: 'Estilo de vida',
  savings: 'Poupança',
};

const groupOrderOf = (group: GroupKey | null): number =>
  group === null ? GROUP_KEYS.length : GROUP_KEYS.indexOf(group);

export function toAllocationInputs(
  allocations: SuggestedAllocation[],
): SuggestedAllocationInput[] {
  const nextCategoryOrder = new Map<number, number>();

  return allocations
    .filter(({ suggestedCents }) => suggestedCents > 0)
    .map(({ categoryId, group, suggestedCents }) => {
      const groupOrder = groupOrderOf(group);
      const categoryOrder = nextCategoryOrder.get(groupOrder) ?? 0;
      nextCategoryOrder.set(groupOrder, categoryOrder + 1);

      return {
        categoryId,
        groupName: group === null ? UNGROUPED_NAME : GROUP_NAMES[group],
        groupOrder,
        categoryOrder,
        targetCents: suggestedCents,
      };
    });
}
