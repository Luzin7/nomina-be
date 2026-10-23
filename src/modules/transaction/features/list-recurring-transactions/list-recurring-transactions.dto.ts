import { RecurringKind } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const listRecurringTransactionsSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive('Página deve ser um número positivo')
    .default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive('Tamanho da página deve ser um número positivo')
    .max(50, 'Tamanho da página muito grande')
    .default(20),
  activeOnly: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  kind: z.nativeEnum(RecurringKind).optional(),
});

export const ListRecurringTransactionsPipe = new ZodValidationPipe(
  listRecurringTransactionsSchema,
);
export type ListRecurringTransactionsRequest = z.infer<
  typeof listRecurringTransactionsSchema
>;
