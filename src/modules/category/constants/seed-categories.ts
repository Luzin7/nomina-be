import { TransactionType } from '@constants/enums';

export const SEED_CATEGORIES = {
  ALIMENTACAO: {
    id: 'cat_alimentacao',
    name: 'Alimentação',
    type: TransactionType.EXPENSE,
  },
  MERCADO: {
    id: 'cat_mercado',
    name: 'Mercado',
    type: TransactionType.EXPENSE,
    parentId: 'cat_alimentacao',
  },
  RESTAURANTE: {
    id: 'cat_restaurante',
    name: 'Restaurante',
    type: TransactionType.EXPENSE,
    parentId: 'cat_alimentacao',
  },
  DELIVERY: {
    id: 'cat_delivery',
    name: 'Delivery',
    type: TransactionType.EXPENSE,
    parentId: 'cat_alimentacao',
  },
  TRANSPORTE: {
    id: 'cat_transporte',
    name: 'Transporte',
    type: TransactionType.EXPENSE,
  },
  COMBUSTIVEL: {
    id: 'cat_combustivel',
    name: 'Combustível',
    type: TransactionType.EXPENSE,
    parentId: 'cat_transporte',
  },
  ESTACIONAMENTO: {
    id: 'cat_estacionamento',
    name: 'Estacionamento',
    type: TransactionType.EXPENSE,
    parentId: 'cat_transporte',
  },
  TRANSPORTE_PUBLICO: {
    id: 'cat_transporte_publico',
    name: 'Transporte Público',
    type: TransactionType.EXPENSE,
    parentId: 'cat_transporte',
  },
  MORADIA: {
    id: 'cat_moradia',
    name: 'Moradia',
    type: TransactionType.EXPENSE,
  },
  ALUGUEL: {
    id: 'cat_aluguel',
    name: 'Aluguel',
    type: TransactionType.EXPENSE,
    parentId: 'cat_moradia',
  },
  CONDOMINIO: {
    id: 'cat_condominio',
    name: 'Condomínio',
    type: TransactionType.EXPENSE,
    parentId: 'cat_moradia',
  },
  AGUA: {
    id: 'cat_agua',
    name: 'Água',
    type: TransactionType.EXPENSE,
    parentId: 'cat_moradia',
  },
  LUZ: {
    id: 'cat_luz',
    name: 'Luz',
    type: TransactionType.EXPENSE,
    parentId: 'cat_moradia',
  },
  INTERNET: {
    id: 'cat_internet',
    name: 'Internet',
    type: TransactionType.EXPENSE,
    parentId: 'cat_moradia',
  },
  SAUDE: {
    id: 'cat_saude',
    name: 'Saúde',
    type: TransactionType.EXPENSE,
  },
  PLANO_SAUDE: {
    id: 'cat_plano_saude',
    name: 'Plano de Saúde',
    type: TransactionType.EXPENSE,
    parentId: 'cat_saude',
  },
  FARMACIA: {
    id: 'cat_farmacia',
    name: 'Farmácia',
    type: TransactionType.EXPENSE,
    parentId: 'cat_saude',
  },
  CONSULTA_EXAME: {
    id: 'cat_consulta_exame',
    name: 'Consulta/Exame',
    type: TransactionType.EXPENSE,
    parentId: 'cat_saude',
  },
  EDUCACAO: {
    id: 'cat_educacao',
    name: 'Educação',
    type: TransactionType.EXPENSE,
  },
  CURSO_MENSALIDADE: {
    id: 'cat_curso_mensalidade',
    name: 'Curso/Mensalidade',
    type: TransactionType.EXPENSE,
    parentId: 'cat_educacao',
  },
  MATERIAL: {
    id: 'cat_material',
    name: 'Material',
    type: TransactionType.EXPENSE,
    parentId: 'cat_educacao',
  },
  LAZER: {
    id: 'cat_lazer',
    name: 'Lazer',
    type: TransactionType.EXPENSE,
  },
  ASSINATURA_LAZER: {
    id: 'cat_assinatura_lazer',
    name: 'Assinatura (streaming, academia)',
    type: TransactionType.EXPENSE,
    parentId: 'cat_lazer',
  },
  VIAGEM: {
    id: 'cat_viagem',
    name: 'Viagem',
    type: TransactionType.EXPENSE,
    parentId: 'cat_lazer',
  },
  SAIDA: {
    id: 'cat_saida',
    name: 'Saída (bar, cinema, show)',
    type: TransactionType.EXPENSE,
    parentId: 'cat_lazer',
  },
  SERVICOS: {
    id: 'cat_servicos',
    name: 'Serviços',
    type: TransactionType.EXPENSE,
  },
  ASSINATURA_SERVICO: {
    id: 'cat_assinatura_servico',
    name: 'Assinatura (software)',
    type: TransactionType.EXPENSE,
    parentId: 'cat_servicos',
  },
  SEGURO: {
    id: 'cat_seguro',
    name: 'Seguro',
    type: TransactionType.EXPENSE,
    parentId: 'cat_servicos',
  },
  COMPRAS: {
    id: 'cat_compras',
    name: 'Compras',
    type: TransactionType.EXPENSE,
  },
  VESTUARIO: {
    id: 'cat_vestuario',
    name: 'Vestuário',
    type: TransactionType.EXPENSE,
    parentId: 'cat_compras',
  },
  IMPOSTOS: {
    id: 'cat_impostos',
    name: 'Impostos',
    type: TransactionType.EXPENSE,
  },
  SALARIO: {
    id: 'cat_salario',
    name: 'Salário',
    type: TransactionType.INCOME,
  },
  FREELA: {
    id: 'cat_freela',
    name: 'Freela/Projeto',
    type: TransactionType.INCOME,
  },
  INVESTIMENTOS: {
    id: 'cat_investimentos',
    name: 'Investimentos',
    type: TransactionType.INCOME,
  },
  PRESENTE: {
    id: 'cat_presente',
    name: 'Presente',
    type: TransactionType.INCOME,
  },
  OUTROS: {
    id: 'cat_outros_inc',
    name: 'Outros',
    type: TransactionType.INCOME,
  },
} as const;

type CategoryUnion = (typeof SEED_CATEGORIES)[keyof typeof SEED_CATEGORIES];

type CategoryWithParent = CategoryUnion & { parentId: string };

export type SeedCategoryRef = CategoryUnion;

export const SEED_CATEGORIES_LIST: readonly SeedCategoryRef[] =
  Object.values(SEED_CATEGORIES);

export const SEED_PARENT_CATEGORIES: readonly SeedCategoryRef[] =
  SEED_CATEGORIES_LIST.filter(
    (cat): cat is CategoryUnion => !('parentId' in cat),
  );

export const SEED_CHILD_CATEGORIES: readonly CategoryWithParent[] =
  SEED_CATEGORIES_LIST.filter(
    (cat): cat is CategoryWithParent => 'parentId' in cat,
  );