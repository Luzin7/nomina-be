import { TransactionStatus, TransactionType } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const updateTransaction = z
  .object({
    accountId: z.string().uuid('ID da conta inválido'),
    categoryId: z.string().uuid('ID da categoria inválido').optional(),
    title: z.string().min(1, 'Título é obrigatório'),
    description: z.string().optional().nullable(),
    amount: z.coerce.bigint().positive('Valor deve ser positivo'),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD inválido'),
    type: z.nativeEnum(TransactionType),
    status: z.nativeEnum(TransactionStatus),
    destinationAccountId: z
      .string()
      .uuid('ID da conta destino inválido')
      .optional()
      .nullable(),
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
  .refine(
    (data) =>
      data.type === TransactionType.TRANSFER ? true : !!data.categoryId,
    {
      message: 'Categoria é obrigatória',
      path: ['categoryId'],
    },
  );

export const UpdateTransactionPipe = new ZodValidationPipe(updateTransaction);
export type UpdateTransactionRequest = z.infer<typeof updateTransaction>;
