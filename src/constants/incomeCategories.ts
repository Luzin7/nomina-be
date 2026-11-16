export const INVESTMENTS_CATEGORY_NAME = 'Investimentos';
export const SALARY_CATEGORY_NAME = 'Salário';
export const FREELANCE_CATEGORY_NAME = 'Freela/Projeto';

export const REAL_INCOME_ROOT_NAMES = [
  SALARY_CATEGORY_NAME,
  FREELANCE_CATEGORY_NAME,
] as const;

export const NON_INCOME_ROOT_NAMES = ['Reembolsos'] as const;

export const YIELD_SUBCATEGORY_NAMES = [
  'Rendimento CDB',
  'Rendimento',
  'Rendimentos',
  'Dividendos',
  'Juros',
] as const;
