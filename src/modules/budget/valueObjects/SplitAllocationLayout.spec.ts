import type { SuggestedAllocation } from './SplitSuggestion';
import { toAllocationInputs } from './SplitAllocationLayout';

const makeAllocation = (
  overrides: Partial<SuggestedAllocation> = {},
): SuggestedAllocation => ({
  categoryId: 'cat-1',
  group: 'essentials',
  actualCents: 1_000,
  idealCents: 1_000,
  suggestedCents: 1_000,
  ...overrides,
});

describe('toAllocationInputs', () => {
  it('names groups in pt-BR and orders them essentials, lifestyle, savings, none', () => {
    const inputs = toAllocationInputs([
      makeAllocation({ categoryId: 'none', group: null }),
      makeAllocation({ categoryId: 'savings', group: 'savings' }),
      makeAllocation({ categoryId: 'lifestyle', group: 'lifestyle' }),
      makeAllocation({ categoryId: 'essentials', group: 'essentials' }),
    ]);

    expect(
      inputs.map(({ categoryId, groupName, groupOrder }) => [
        categoryId,
        groupName,
        groupOrder,
      ]),
    ).toEqual([
      ['none', 'Sem grupo', 3],
      ['savings', 'Poupança', 2],
      ['lifestyle', 'Estilo de vida', 1],
      ['essentials', 'Essenciais', 0],
    ]);
  });

  it('numbers categories within each group in input order', () => {
    const inputs = toAllocationInputs([
      makeAllocation({ categoryId: 'a' }),
      makeAllocation({ categoryId: 'b', group: 'lifestyle' }),
      makeAllocation({ categoryId: 'c' }),
    ]);

    expect(inputs.map(({ categoryOrder }) => categoryOrder)).toEqual([0, 0, 1]);
  });

  it('writes the suggested value as the target and drops zero targets', () => {
    const inputs = toAllocationInputs([
      makeAllocation({ categoryId: 'kept', suggestedCents: 700 }),
      makeAllocation({ categoryId: 'dropped', suggestedCents: 0 }),
    ]);

    expect(inputs).toEqual([
      {
        categoryId: 'kept',
        groupName: 'Essenciais',
        groupOrder: 0,
        categoryOrder: 0,
        targetCents: 700,
      },
    ]);
  });
});
