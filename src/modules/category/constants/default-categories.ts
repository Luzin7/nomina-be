import { TransactionType } from '@constants/enums';
import {
  FREELANCE_CATEGORY_NAME,
  INVESTMENTS_CATEGORY_NAME,
  SALARY_CATEGORY_NAME,
} from '@constants/incomeCategories';
import { Category } from '@modules/category/entities/Category';

export interface DefaultCategoryNode {
  name: string;
  type: TransactionType;
  children?: readonly string[];
}

export const DEFAULT_CATEGORIES: readonly DefaultCategoryNode[] = [
  {
    name: 'Alimentação',
    type: TransactionType.EXPENSE,
    children: ['Restaurante', 'Delivery', 'Lanche', 'Café/Padaria'],
  },
  {
    name: 'Supermercado',
    type: TransactionType.EXPENSE,
    children: ['Mercearia', 'Higiene', 'Limpeza', 'Bebidas', 'Utilidades'],
  },
  {
    name: 'Compras',
    type: TransactionType.EXPENSE,
    children: [
      'Cosméticos',
      'Roupas',
      'Acessórios',
      'Eletrônicos',
      'Presentes',
    ],
  },
  {
    name: 'Moradia',
    type: TransactionType.EXPENSE,
    children: [
      'Aluguel',
      'Condomínio',
      'Luz',
      'Água',
      'Internet',
      'Manutenção da Casa',
    ],
  },
  {
    name: 'Serviços',
    type: TransactionType.EXPENSE,
    children: ['Telefonia', 'Assinatura (software)', 'Seguro'],
  },
  {
    name: 'Saúde',
    type: TransactionType.EXPENSE,
    children: ['Consulta/Exame', 'Farmácia', 'Plano de Saúde', 'Academia'],
  },
  {
    name: 'Pets',
    type: TransactionType.EXPENSE,
    children: ['Ração', 'Petshop', 'Veterinário', 'Plano de Saúde Pet'],
  },
  {
    name: 'Transporte',
    type: TransactionType.EXPENSE,
    children: [
      'Combustível',
      'Estacionamento',
      'Manutenção do Carro',
      'Transporte Público',
      'Pedágio',
      'App/Corrida',
    ],
  },
  {
    name: 'Lazer',
    type: TransactionType.EXPENSE,
    children: [
      'Cinema',
      'Bar/Show',
      'Eventos',
      'Hobbies',
      'Viagem',
      'Streaming',
    ],
  },
  {
    name: 'Educação',
    type: TransactionType.EXPENSE,
    children: ['Curso/Mensalidade', 'Material'],
  },
  {
    name: 'Impostos',
    type: TransactionType.EXPENSE,
    children: ['IR', 'IPVA', 'IPTU', 'Taxas'],
  },
  { name: INVESTMENTS_CATEGORY_NAME, type: TransactionType.EXPENSE },
  { name: 'Outros Gastos', type: TransactionType.EXPENSE },
  { name: SALARY_CATEGORY_NAME, type: TransactionType.INCOME },
  { name: FREELANCE_CATEGORY_NAME, type: TransactionType.INCOME },
  { name: 'Reembolsos', type: TransactionType.INCOME },
  { name: 'Outros', type: TransactionType.INCOME },
  {
    name: INVESTMENTS_CATEGORY_NAME,
    type: TransactionType.INCOME,
    children: ['Rendimento CDB'],
  },
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
