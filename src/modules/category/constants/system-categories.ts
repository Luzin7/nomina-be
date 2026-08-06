import { TransactionType } from '@constants/enums';

/**
 * Toda transação precisa de uma categoria, mas há operações em que pedir uma ao
 * usuário não faz sentido: transferência entre contas próprias e pagamento de
 * fatura não são gasto nem receita, são movimentação interna.
 *
 * Nesses casos o backend atribui uma categoria de sistema (`workspaceId = null`,
 * `isSystemCategory = true`). O ID é **fixo e conhecido em tempo de compilação**,
 * não gerado pelo banco: o código usa a constante direto, sem consultar o banco
 * a cada transferência só para descobrir um ID que já se sabe qual é.
 *
 * O que torna isso seguro é a migration `0013` garantir essas linhas com esses
 * IDs exatos — inclusive corrigindo o ID de bancos onde a categoria já existia
 * com um UUID aleatório do seed. `drizzle/seed.ts` usa as mesmas constantes.
 *
 * Nunca reaproveite nem altere um ID daqui: eles são chave estrangeira de
 * transações já gravadas.
 */
export const SYSTEM_CATEGORY = {
  TRANSFER: {
    id: '19323ba9-e496-4db9-9c22-b2a5c7cb790e',
    name: 'Transferência',
    type: TransactionType.TRANSFER,
  },
  CREDIT_CARD_PAYMENT: {
    id: '0d19bbf8-b66a-4cc2-9c7c-3fcd961f06b1',
    name: 'Cartão de Crédito',
    type: TransactionType.EXPENSE,
  },
} as const;

export type SystemCategoryRef =
  (typeof SYSTEM_CATEGORY)[keyof typeof SYSTEM_CATEGORY];

export const SYSTEM_CATEGORY_LIST: readonly SystemCategoryRef[] =
  Object.values(SYSTEM_CATEGORY);
