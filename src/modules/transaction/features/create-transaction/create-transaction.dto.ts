import { TransactionStatus, TransactionType } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const createTransactionSchema = z
  .object({
    accountId: z.string().uuid('ID da conta inválido'),
    categoryId: z.string().uuid('ID da categoria inválido').optional(),
    title: z.string().min(1, 'Título é obrigatório'),
    description: z.string().optional().nullable(),
    amount: z.coerce.bigint().positive('Valor deve ser positivo'),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
    type: z.nativeEnum(TransactionType),
    status: z.nativeEnum(TransactionStatus).optional(),
    destinationAccountId: z.string().uuid().optional().nullable(),
  })
  .refine(
    (data) =>
      data.type === TransactionType.TRANSFER
        ? !!data.destinationAccountId
        : true,
    {
      message: 'Conta destino é obrigatória para transferências',
      path: ['destinationAccountId'],
    },
  )
  // Transferência não é gasto nem receita: o backend resolve a categoria de
  // sistema `Transferência` sozinho. Nos demais tipos a categoria é do usuário
  // e, portanto, obrigatória.
  .refine(
    (data) =>
      data.type === TransactionType.TRANSFER ? true : !!data.categoryId,
    {
      message: 'Categoria é obrigatória',
      path: ['categoryId'],
    },
  );

export type CreateTransactionRequest = z.infer<typeof createTransactionSchema>;
export const CreateTransactionPipe = new ZodValidationPipe(
  createTransactionSchema,
);
