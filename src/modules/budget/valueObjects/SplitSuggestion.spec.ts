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

  it('excludes unmapped categories from the allocations and reports their spending', () => {
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
    expect(
      result.allocations.find((a) => a.categoryId === 'pets'),
    ).toBeUndefined();
    expect(result.unallocatedCents).toBe(50_000);
  });

  it('reports no unallocated amount when every root is mapped', () => {
    const result = buildSplitSuggestion(
      makeInput({
        categories: CATEGORIES.filter((category) => category.name !== 'Pets'),
      }),
    );

    expect(result.unmappedCategoryIds).toEqual([]);
    expect(result.unallocatedCents).toBe(0);
  });

  describe('unmapped roots', () => {
    const CATEGORIES_WITH_UNMAPPED: SuggestionCategory[] = [
      { id: 'housing', name: 'Moradia', parentId: null, hidden: false },
      { id: 'leisure', name: 'Lazer', parentId: null, hidden: false },
      { id: 'invest', name: 'Investimentos', parentId: null, hidden: false },
      { id: 'donations', name: 'Doações', parentId: null, hidden: false },
      { id: 'course', name: 'Curso de inglês', parentId: null, hidden: false },
    ];

    const SPEND = {
      housing: 250_000,
      leisure: 120_000,
      invest: 60_000,
      donations: 20_000,
      course: 20_200,
    };

    const inputOf = (step: number) =>
      makeInput({
        categories: CATEGORIES_WITH_UNMAPPED,
        spendByMonth: [SPEND, SPEND, SPEND],
        groupByCategoryName: {
          Moradia: 'essentials',
          Lazer: 'lifestyle',
          Investimentos: 'savings',
        },
        incomeBasisCents: 450_000,
        step,
      });

    it.each([1, 2, 3, 4, 5, 6])(
      'keeps the step %i plan at or below income and matches the internal ideal',
      (step) => {
        const { allocations, unallocatedCents } = buildSplitSuggestion(
          inputOf(step),
        );
        const suggestedTotal = allocations.reduce(
          (total, allocation) => total + allocation.suggestedCents,
          0,
        );
        const idealTotal = allocations.reduce(
          (total, allocation) => total + (allocation.idealCents ?? 0),
          0,
        );

        expect(suggestedTotal).toBeLessThanOrEqual(450_000);
        expect(idealTotal).toBe(450_000);
        expect(
          allocations.map((allocation) => allocation.categoryId),
        ).not.toEqual(expect.arrayContaining(['donations', 'course']));
        expect(unallocatedCents).toBe(40_200);
      },
    );

    it('matches the internal ideal at the last step', () => {
      const { allocations } = buildSplitSuggestion(inputOf(6));

      expect(
        allocations.reduce(
          (total, allocation) => total + allocation.suggestedCents,
          0,
        ),
      ).toBe(450_000);
    });
  });

  describe('chained steps', () => {
    const CHAIN_CATEGORIES: SuggestionCategory[] = [
      { id: 'housing', name: 'Moradia', parentId: null, hidden: false },
      { id: 'leisure', name: 'Lazer', parentId: null, hidden: false },
      { id: 'invest', name: 'Investimentos', parentId: null, hidden: false },
    ];

    const CHAIN_SPEND = { housing: 416_000, invest: 49_800 };

    const chainInput = (
      step: number,
      currentTargets: Record<string, number>,
    ): SplitSuggestionInput =>
      makeInput({
        categories: CHAIN_CATEGORIES,
        spendByMonth: [CHAIN_SPEND, CHAIN_SPEND, CHAIN_SPEND],
        incomeBasisCents: 465_800,
        currentTargets,
        step,
      });

    it('never overtakes the income as the targets are carried across steps', () => {
      let targets: Record<string, number> = {};
      const totals: number[] = [];

      for (let step = 1; step <= 6; step += 1) {
        const { allocations } = buildSplitSuggestion(chainInput(step, targets));
        const total = allocations.reduce(
          (sum, allocation) => sum + allocation.suggestedCents,
          0,
        );

        totals.push(total);
        expect(total).toBeLessThanOrEqual(465_800);
        targets = Object.fromEntries(
          allocations.map((allocation) => [
            allocation.categoryId,
            allocation.suggestedCents,
          ]),
        );
      }

      expect(totals.at(-1)).toBe(465_800);
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
    [1, 333_300, 383_300, 33_300],
    [2, 340_000, 380_000, 40_000],
    [3, 350_000, 375_000, 50_000],
    [4, 366_700, 366_700, 66_700],
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
  describe('whole reais', () => {
    const allocationsOf = (input: SplitSuggestionInput) =>
      buildSplitSuggestion(input).allocations;
    const lastStep = { step: 6, steps: 6 };

    it('sums to the income and keeps every limit a multiple of 100', () => {
      const result = allocationsOf(
        makeInput({ incomeBasisCents: 1_234_500, ...lastStep }),
      );

      expect(result.reduce((t, a) => t + a.suggestedCents, 0)).toBe(1_234_500);
      expect(result.map((a) => a.suggestedCents % 100)).toEqual([0, 0, 0]);
    });

    it('puts the leftover cents on the largest allocation when income is not whole reais', () => {
      const result = allocationsOf(
        makeInput({ incomeBasisCents: 1_234_567, ...lastStep }),
      );

      expect(result.reduce((t, a) => t + a.suggestedCents, 0)).toBe(1_234_567);
      expect(result.map((a) => a.suggestedCents % 100)).toEqual([67, 0, 0]);
    });

    it('keeps ideals in whole reais on intermediate steps', () => {
      const result = allocationsOf(
        makeInput({ incomeBasisCents: 1_234_567, step: 1, steps: 6 }),
      );

      expect(result.map((a) => a.suggestedCents % 100)).toEqual([0, 0, 0]);
    });

    it('rounds the observed spending to whole reais half up without income', () => {
      const result = allocationsOf(
        makeInput({
          incomeBasisCents: null,
          bracket: null,
          spendByMonth: [{ housing: 79_732, leisure: 12_350 }],
        }),
      );

      expect(result.map((a) => a.suggestedCents)).toEqual([79_700, 12_400]);
    });

    it('never rounds a positive observed spending down to zero', () => {
      const result = allocationsOf(
        makeInput({
          incomeBasisCents: null,
          bracket: null,
          spendByMonth: [{ housing: 20, leisure: 400_000 }],
        }),
      );

      expect(result.map((a) => a.suggestedCents)).toEqual([100, 400_000]);
    });
  });
});
