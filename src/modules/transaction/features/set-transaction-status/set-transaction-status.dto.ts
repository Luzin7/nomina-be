import { TransactionStatus } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const setTransactionStatusSchema = z.object({
  status: z.nativeEnum(TransactionStatus, {
    errorMap: () => ({ message: 'Status da transação inválido' }),
  }),
});

export const SetTransactionStatusPipe = new ZodValidationPipe(
  setTransactionStatusSchema,
);
export type SetTransactionStatusRequest = z.infer<
  typeof setTransactionStatusSchema
>;
