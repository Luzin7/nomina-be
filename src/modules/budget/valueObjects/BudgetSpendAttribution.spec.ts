import { attributeSpendToAllocations } from './BudgetSpendAttribution';

const parentById: Record<string, string | null> = {
  moradia: null,
  aluguel: 'moradia',
  internet: 'moradia',
  lazer: null,
  cinema: 'lazer',
  other: null,
};

describe('attributeSpendToAllocations', () => {
  it('rolls a child transaction up to its allocated parent', () => {
    expect(
      attributeSpendToAllocations(
        { aluguel: 150_000 },
        parentById,
        new Set(['moradia']),
      ),
    ).toEqual({
      spentByAllocation: { moradia: 150_000 },
      unallocatedSpent: 0,
    });
  });

  it('adds sibling children together under the same parent', () => {
    expect(
      attributeSpendToAllocations(
        { aluguel: 150_000, internet: 12_000 },
        parentById,
        new Set(['moradia']),
      ),
    ).toEqual({
      spentByAllocation: { moradia: 162_000 },
      unallocatedSpent: 0,
    });
  });

  it('keeps a child of an unallocated parent as unallocated spend', () => {
    expect(
      attributeSpendToAllocations(
        { cinema: 8_000 },
        parentById,
        new Set(['moradia']),
      ),
    ).toEqual({
      spentByAllocation: {},
      unallocatedSpent: 8_000,
    });
  });

  it('counts a transaction on the nearest allocated ancestor only once', () => {
    expect(
      attributeSpendToAllocations(
        { aluguel: 150_000 },
        parentById,
        new Set(['moradia', 'aluguel']),
      ),
    ).toEqual({
      spentByAllocation: { aluguel: 150_000 },
      unallocatedSpent: 0,
    });
  });

  it('treats a category with no parent entry as unallocated', () => {
    expect(
      attributeSpendToAllocations(
        { unknown: 1_000 },
        parentById,
        new Set(['moradia']),
      ),
    ).toEqual({
      spentByAllocation: {},
      unallocatedSpent: 1_000,
    });
  });
});
