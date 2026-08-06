import { TransactionType } from '@constants/enums';

/**
 * Toda transação precisa de uma categoria, mas há operações em que pedir uma ao
 * usuário não faz sentido: transferência entre contas próprias e pagamento de
 * fatura não são gasto nem receita, são movimentação interna.
 *
 * Para esses casos o backend resolve uma categoria de sistema
 * (`workspaceId = null`, `isSystemCategory = true`) pelo nome. Resolver pelo
 * nome — e não por um UUID fixo no código — é o que garante que funcione em
 * qualquer banco, já que o seed gera os IDs.
 *
 * Os nomes aqui precisam bater exatamente com `categoriesData` em
 * `drizzle/seed.ts`.
 */
export const SYSTEM_CATEGORY = {
  TRANSFER: {
    name: 'Transferência',
    type: TransactionType.TRANSFER,
  },
  CREDIT_CARD_PAYMENT: {
    name: 'Cartão de Crédito',
    type: TransactionType.EXPENSE,
  },
} as const;

export type SystemCategoryRef =
  (typeof SYSTEM_CATEGORY)[keyof typeof SYSTEM_CATEGORY];
