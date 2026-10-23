import { TransactionType } from '@constants/enums';
import { DEFAULT_CATEGORIES } from './default-categories';

const allNames = DEFAULT_CATEGORIES.flatMap((node) => [
  node.name,
  ...(node.children ?? []),
]);

describe('DEFAULT_CATEGORIES', () => {
  it('has non-empty names', () => {
    for (const name of allNames) {
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no id property on any node', () => {
    for (const node of DEFAULT_CATEGORIES) {
      expect('id' in node).toBe(false);
    }
  });

  it('has no duplicate names', () => {
    expect(new Set(allNames).size).toBe(allNames.length);
  });

  it('has every child name attached to an existing parent', () => {
    for (const node of DEFAULT_CATEGORIES) {
      expect(allNames).toContain(node.name);
      for (const child of node.children ?? []) {
        expect(allNames).toContain(child);
      }
    }
  });

  it('has 10 EXPENSE parents, 5 INCOME parents and 22 children', () => {
    expect(
      DEFAULT_CATEGORIES.filter(
        (node) => node.type === TransactionType.EXPENSE,
      ),
    ).toHaveLength(10);
    expect(
      DEFAULT_CATEGORIES.filter((node) => node.type === TransactionType.INCOME),
    ).toHaveLength(5);
    expect(
      DEFAULT_CATEGORIES.reduce(
        (total, node) => total + (node.children?.length ?? 0),
        0,
      ),
    ).toBe(22);
  });

  it('uses the pt-BR starter names', () => {
    for (const name of [
      'Alimentação',
      'Mercado',
      'Transporte',
      'Moradia',
      'Saúde',
      'Educação',
      'Lazer',
      'Serviços',
      'Compras',
      'Impostos',
      'Outros Gastos',
      'Salário',
      'Outros',
    ]) {
      expect(allNames).toContain(name);
    }
  });

  it('does not contain the English names from an earlier iteration', () => {
    for (const legacy of [
      'Food',
      'Groceries',
      'Transportation',
      'Other Expense',
    ]) {
      expect(allNames).not.toContain(legacy);
    }
  });
});
