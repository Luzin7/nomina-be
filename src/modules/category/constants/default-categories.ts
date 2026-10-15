import { TransactionType } from '@constants/enums';
import { Category } from '@modules/category/entities/Category';

export interface DefaultCategoryNode {
  name: string;
  type: TransactionType;
  children?: readonly string[];
}

// Mirrored by the backfill VALUES in drizzle/0018_workspace_default_categories.sql; change both together.
export const DEFAULT_CATEGORIES: readonly DefaultCategoryNode[] = [
  {
    name: 'Alimentação',
    type: TransactionType.EXPENSE,
    children: ['Mercado', 'Restaurante', 'Delivery'],
  },
  {
    name: 'Transporte',
    type: TransactionType.EXPENSE,
    children: ['Combustível', 'Estacionamento', 'Transporte Público'],
  },
  {
    name: 'Moradia',
    type: TransactionType.EXPENSE,
    children: ['Aluguel', 'Condomínio', 'Água', 'Luz', 'Internet'],
  },
  {
    name: 'Saúde',
    type: TransactionType.EXPENSE,
    children: ['Plano de Saúde', 'Farmácia', 'Consulta/Exame'],
  },
  {
    name: 'Educação',
    type: TransactionType.EXPENSE,
    children: ['Curso/Mensalidade', 'Material'],
  },
  {
    name: 'Lazer',
    type: TransactionType.EXPENSE,
    children: [
      'Assinatura (streaming, academia)',
      'Viagem',
      'Saída (bar, cinema, show)',
    ],
  },
  {
    name: 'Serviços',
    type: TransactionType.EXPENSE,
    children: ['Assinatura (software)', 'Seguro'],
  },
  { name: 'Compras', type: TransactionType.EXPENSE, children: ['Vestuário'] },
  { name: 'Impostos', type: TransactionType.EXPENSE },
  { name: 'Outros Gastos', type: TransactionType.EXPENSE },
  { name: 'Salário', type: TransactionType.INCOME },
  { name: 'Investimentos', type: TransactionType.INCOME },
  { name: 'Freela/Projeto', type: TransactionType.INCOME },
  { name: 'Presente', type: TransactionType.INCOME },
  { name: 'Outros', type: TransactionType.INCOME },
] as const;

export function buildDefaultCategories(workspaceId: string): Category[] {
  const parents = DEFAULT_CATEGORIES.map((node) => ({
    node,
    category: createCategory({
      workspaceId,
      name: node.name,
      type: node.type,
      parentId: null,
    }),
  }));

  return parents.flatMap(({ node, category }) => [
    category,
    ...(node.children ?? []).map((childName) =>
      createCategory({
        workspaceId,
        name: childName,
        type: node.type,
        parentId: category.id,
      }),
    ),
  ]);
}

function createCategory(input: {
  workspaceId: string;
  name: string;
  type: TransactionType;
  parentId: string | null;
}): Category {
  const result = Category.create(
    { ...input, isSystemCategory: false },
    crypto.randomUUID(),
  );

  if (result.isLeft()) {
    throw result.value;
  }

  return result.value;
}
