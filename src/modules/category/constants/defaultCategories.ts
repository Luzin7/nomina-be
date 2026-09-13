import { TransactionType } from '@constants/enums';

export interface DefaultCategorySeed {
  name: string;
  type: TransactionType;
  children?: string[];
}

export const DEFAULT_CATEGORIES: DefaultCategorySeed[] = [
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
    children: ['Assinatura (streaming, academia)', 'Viagem', 'Saída (bar, cinema, show)'],
  },
  {
    name: 'Serviços',
    type: TransactionType.EXPENSE,
    children: ['Assinatura (software)', 'Seguro'],
  },
  {
    name: 'Compras',
    type: TransactionType.EXPENSE,
    children: ['Vestuário'],
  },
  {
    name: 'Impostos',
    type: TransactionType.EXPENSE,
  },
  {
    name: 'Salário',
    type: TransactionType.INCOME,
  },
  {
    name: 'Investimentos',
    type: TransactionType.INCOME,
  },
  {
    name: 'Freela/Projeto',
    type: TransactionType.INCOME,
  },
  {
    name: 'Presente',
    type: TransactionType.INCOME,
  },
  {
    name: 'Outros',
    type: TransactionType.INCOME,
  },
];
