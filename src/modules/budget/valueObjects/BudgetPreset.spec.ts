import { buildPresetAllocations, PresetInput } from './BudgetPreset';

const DEFAULT_EXPENSES: PresetInput[] = [
  { id: 'home', name: 'Moradia' },
  { id: 'food', name: 'Alimentação' },
  { id: 'transport', name: 'Transporte' },
  { id: 'health', name: 'Saúde' },
  { id: 'services', name: 'Serviços' },
  { id: 'leisure', name: 'Lazer' },
  { id: 'shopping', name: 'Compras' },
  { id: 'education', name: 'Educação' },
  { id: 'taxes', name: 'Impostos' },
  { id: 'other', name: 'Outros Gastos' },
];

describe('buildPresetAllocations', () => {
  it('splits 100% across the default expense categories', () => {
    const allocations = buildPresetAllocations(DEFAULT_EXPENSES);

    expect(
      allocations.reduce(
        (total, allocation) => total + allocation.percentageOfIncome,
        0,
      ),
    ).toBe(100);
    expect(allocations).toHaveLength(DEFAULT_EXPENSES.length);
  });

  it('groups known categories under their pillar', () => {
    const allocations = buildPresetAllocations(DEFAULT_EXPENSES);
    const groups = Object.fromEntries(
      allocations.map((allocation) => [
        allocation.categoryName,
        allocation.groupName,
      ]),
    );

    expect(groups.Moradia).toBe('Custos fixos');
    expect(groups.Lazer).toBe('Conforto');
    expect(groups.Educação).toBe('Conhecimento');
    expect(groups.Impostos).toBe('Outros');
  });

  it('keeps the split summing to 100 with a custom category', () => {
    const allocations = buildPresetAllocations([
      ...DEFAULT_EXPENSES,
      { id: 'pets', name: 'Pets' },
    ]);

    expect(
      allocations.reduce(
        (total, allocation) => total + allocation.percentageOfIncome,
        0,
      ),
    ).toBe(100);
    expect(
      allocations.find((allocation) => allocation.categoryId === 'pets')
        ?.groupName,
    ).toBe('Outros');
  });

  it('returns an empty list when the workspace has no expense category', () => {
    expect(buildPresetAllocations([])).toEqual([]);
  });
});
