import { RecurrenceFrequency } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const updateRecurringTransactionSchema = z
  .object({
    accountId: z.string().uuid('ID da conta inválido').optional(),
    categoryId: z
      .string()
      .uuid('ID da categoria inválido')
      .nullable()
      .optional(),
    title: z.string().min(1, 'Título é obrigatório').optional(),
    description: z.string().optional().nullable(),
    amount: z.coerce.bigint().positive('Valor deve ser positivo').optional(),
    frequency: z.nativeEnum(RecurrenceFrequency).optional(),
    interval: z.coerce
      .number()
      .int()
      .positive('Intervalo deve ser um número positivo')
      .optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato deve ser YYYY-MM-DD')
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato deve ser YYYY-MM-DD')
      .nullable()
      .optional(),
    destinationAccountId: z
      .string()
      .uuid('ID da conta destino inválido')
      .nullable()
      .optional(),
  })
  .strict();

export { updateRecurringTransactionSchema };

export const UpdateRecurringTransactionPipe = new ZodValidationPipe(
  updateRecurringTransactionSchema,
);
export type UpdateRecurringTransactionRequest = z.infer<
  typeof updateRecurringTransactionSchema
>;
