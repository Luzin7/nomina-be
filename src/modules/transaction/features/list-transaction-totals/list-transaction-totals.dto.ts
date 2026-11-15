import { transactionFiltersSchema } from '@modules/transaction/features/list-transaction/list-transaction.dto';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

export type ListTransactionTotalsRequest = z.infer<
  typeof transactionFiltersSchema
>;
export const ListTransactionTotalsPipe = new ZodValidationPipe(
  transactionFiltersSchema,
);
