import type { ResolvedBracket } from './IncomeBracket';
import {
  buildSplitSuggestion,
  type SplitSuggestionInput,
  type SuggestionCategory,
} from './SplitSuggestion';

const CATEGORIES: SuggestionCategory[] = [
  { id: 'housing', name: 'Moradia', parentId: null, hidden: false },
  { id: 'rent', name: 'Aluguel', parentId: 'housing', hidden: false },
  { id: 'food', name: 'Alimentação', parentId: null, hidden: false },
  { id: 'leisure', name: 'Lazer', parentId: null, hidden: false },
  { id: 'invest', name: 'Investimentos', parentId: null, hidden: false },
  { id: 'pets', name: 'Pets', parentId: null, hidden: false },
  { id: 'secret', name: 'Moradia', parentId: null, hidden: true },
];

const BRACKET: ResolvedBracket = {
  position: 3,
  shares: { essentials: 5000, lifestyle: 3000, savings: 2000 },
};

const GROUPS = {
  Moradia: 'essentials',
  Alimentação: 'essentials',
  Lazer: 'lifestyle',
  Investimentos: 'savings',
} as const;

function makeInput(
  overrides: Partial<SplitSuggestionInput> = {},
): SplitSuggestionInput {
  return {
    categories: CATEGORIES,
    spendByMonth: [
      { housing: 300_000, leisure: 400_000 },
      { housing: 300_000, leisure: 400_000 },
      { housing: 300_000, leisure: 400_000 },
    ],
    groupByCategoryName: GROUPS,
    incomeBasisCents: 1_000_000,
    bracket: BRACKET,
    currentTargets: {},
    step: 1,
    steps: 6,
    ...overrides,
  };
}

const suggestedOf = (input: SplitSuggestionInput) =>
  Object.fromEntries(
    buildSplitSuggestion(input).allocations.map((allocation) => [
      allocation.categoryId,
      allocation.suggestedCents,
    ]),
  );

describe('buildSplitSuggestion', () => {
  it('suggests the observed spending when there is no income basis', () => {
    const result = buildSplitSuggestion(
      makeInput({ incomeBasisCents: null, bracket: null }),
    );

    expect(result.allocations).toEqual([
      {
        categoryId: 'housing',
        group: 'essentials',
        actualCents: 300_000,
        idealCents: null,
        suggestedCents: 300_000,
      },
      {
        categoryId: 'leisure',
        group: 'lifestyle',
        actualCents: 400_000,
        idealCents: null,
        suggestedCents: 400_000,
      },
    ]);
  });

  it('falls back to the observed spending when the bracket is unavailable', () => {
    expect(suggestedOf(makeInput({ bracket: null }))).toEqual({
      housing: 300_000,
      leisure: 400_000,
    });
  });

  it('rolls child spending up to its root and takes the median month', () => {
    const result = buildSplitSuggestion(
      makeInput({
        incomeBasisCents: null,
        bracket: null,
        spendByMonth: [
          { housing: 100_000, rent: 200_000 },
          { rent: 300_000 },
          { housing: 900_000 },
        ],
      }),
    );

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]).toMatchObject({
      categoryId: 'housing',
      actualCents: 300_000,
    });
  });

  it('keeps unmapped categories at their observed spending', () => {
    const result = buildSplitSuggestion(
      makeInput({
        spendByMonth: [
          { housing: 300_000, pets: 50_000 },
          { housing: 300_000, pets: 50_000 },
          { housing: 300_000, pets: 50_000 },
        ],
      }),
    );

    expect(result.unmappedCategoryIds).toEqual(['pets']);
    expect(result.allocations.find((a) => a.categoryId === 'pets')).toEqual({
      categoryId: 'pets',
      group: null,
      actualCents: 50_000,
      idealCents: null,
      suggestedCents: 50_000,
    });
  });

  it('places the ideal of a group without spend on its preset categories', () => {
    const result = buildSplitSuggestion(makeInput({ step: 6 }));

    expect(
      result.allocations.find((a) => a.categoryId === 'invest'),
    ).toMatchObject({
      group: 'savings',
      actualCents: 0,
      idealCents: 200_000,
      suggestedCents: 200_000,
    });
  });

  it('splits the group ideal by the user own mix', () => {
    const result = buildSplitSuggestion(
      makeInput({
        step: 6,
        spendByMonth: [
          { housing: 300_000, food: 100_000 },
          { housing: 300_000, food: 100_000 },
          { housing: 300_000, food: 100_000 },
        ],
      }),
    );

    expect(
      result.allocations.filter((a) => a.group === 'essentials'),
    ).toMatchObject([
      { categoryId: 'housing', idealCents: 375_000 },
      { categoryId: 'food', idealCents: 125_000 },
    ]);
  });

  it.each([
    [1, 333_333, 383_333, 33_333],
    [2, 340_000, 380_000, 40_000],
    [3, 350_000, 375_000, 50_000],
    [4, 366_667, 366_667, 66_667],
    [5, 400_000, 350_000, 100_000],
    [6, 500_000, 300_000, 200_000],
  ])(
    'glides a fraction of the gap at step %i',
    (step, housing, leisure, invest) => {
      expect(suggestedOf(makeInput({ step }))).toEqual({
        housing,
        leisure,
        invest,
      });
    },
  );

  it('catches up the remaining gap over the remaining steps after a skipped month', () => {
    const suggested = suggestedOf(
      makeInput({ step: 3, currentTargets: { housing: 333_333 } }),
    );

    expect(suggested.housing).toBe(375_000);
  });

  it('never suggests a hidden category', () => {
    const result = buildSplitSuggestion(
      makeInput({
        spendByMonth: [
          { secret: 10_000 },
          { secret: 10_000 },
          { secret: 10_000 },
        ],
      }),
    );

    expect(
      result.allocations.find((a) => a.categoryId === 'secret'),
    ).toBeUndefined();
  });
});
