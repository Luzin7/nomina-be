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
  { id: 'investments', name: 'Investimentos' },
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

  it('gives every default expense category a non-zero share', () => {
    const allocations = buildPresetAllocations(DEFAULT_EXPENSES);

    for (const allocation of allocations) {
      expect(allocation.percentageOfIncome).toBeGreaterThan(0);
    }
  });

  it('allocates the documented weights', () => {
    const allocations = buildPresetAllocations(DEFAULT_EXPENSES);

    expect(
      Object.fromEntries(
        allocations.map((allocation) => [
          allocation.categoryName,
          allocation.percentageOfIncome,
        ]),
      ),
    ).toEqual({
      Moradia: 28,
      Alimentação: 15,
      Transporte: 6,
      Saúde: 5,
      Serviços: 3,
      Lazer: 6,
      Compras: 4,
      Educação: 3,
      Impostos: 2,
      Investimentos: 25,
      'Outros Gastos': 3,
    });
  });

  it('reserves 25% for Investimentos', () => {
    const allocations = buildPresetAllocations(DEFAULT_EXPENSES);
    const investments = allocations.find(
      (allocation) => allocation.categoryName === 'Investimentos',
    );

    expect(investments?.percentageOfIncome).toBe(25);
    expect(investments?.groupName).toBe('Investimentos');
  });

  it('groups known categories under their pillar', () => {
    const allocations = buildPresetAllocations(DEFAULT_EXPENSES);
    const groups = Object.fromEntries(
      allocations.map((allocation) => [
        allocation.categoryName,
        allocation.groupName,
      ]),
    );

    expect(
      new Set(allocations.map((allocation) => allocation.groupName)),
    ).toEqual(
      new Set([
        'Custos fixos',
        'Conforto',
        'Conhecimento',
        'Impostos',
        'Investimentos',
        'Outros',
      ]),
    );
    expect(groups.Moradia).toBe('Custos fixos');
    expect(groups.Lazer).toBe('Conforto');
    expect(groups.Educação).toBe('Conhecimento');
    expect(groups.Impostos).toBe('Impostos');
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
