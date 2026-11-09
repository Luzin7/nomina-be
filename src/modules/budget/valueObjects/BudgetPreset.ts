export type PresetInput = {
  id: string;
  name: string;
};

export type PresetAllocation = {
  categoryId: string;
  categoryName: string;
  percentageOfIncome: number;
  groupName: string;
};

type PresetRule = {
  groupName: string;
  weight: number;
};

const DEFAULT_RULE: PresetRule = { groupName: 'Outros', weight: 1 };

const PRESET_RULES: Record<string, PresetRule> = {
  Moradia: { groupName: 'Custos fixos', weight: 28 },
  Alimentação: { groupName: 'Custos fixos', weight: 15 },
  Transporte: { groupName: 'Custos fixos', weight: 6 },
  Saúde: { groupName: 'Custos fixos', weight: 5 },
  Serviços: { groupName: 'Custos fixos', weight: 3 },
  Lazer: { groupName: 'Conforto', weight: 6 },
  Compras: { groupName: 'Conforto', weight: 4 },
  Educação: { groupName: 'Conhecimento', weight: 3 },
  Impostos: { groupName: 'Impostos', weight: 2 },
  Investimentos: { groupName: 'Investimentos', weight: 25 },
  'Outros Gastos': { groupName: 'Outros', weight: 3 },
};

const TOTAL_PERCENTAGE = 100;

function distributePercentages(weights: number[]): number[] {
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  if (totalWeight === 0) return weights.map(() => 0);

  const exact = weights.map(
    (weight) => (weight * TOTAL_PERCENTAGE) / totalWeight,
  );
  const percentages = exact.map((value) => Math.floor(value));
  const allocated = percentages.reduce((total, value) => total + value, 0);

  const remainderOrder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (
    let position = 0;
    position < TOTAL_PERCENTAGE - allocated;
    position += 1
  ) {
    percentages[remainderOrder[position % remainderOrder.length].index] += 1;
  }

  return percentages;
}

export function buildPresetAllocations(
  categories: PresetInput[],
): PresetAllocation[] {
  if (categories.length === 0) return [];

  const rules = categories.map(
    (category) => PRESET_RULES[category.name] ?? DEFAULT_RULE,
  );
  const percentages = distributePercentages(rules.map((rule) => rule.weight));

  return categories.map((category, index) => ({
    categoryId: category.id,
    categoryName: category.name,
    percentageOfIncome: percentages[index],
    groupName: rules[index].groupName,
  }));
}
