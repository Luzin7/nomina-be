import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const saveCardCycleBudgetSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limitCents: z.number(),
});

export type SaveCardCycleBudgetRequest = z.infer<
  typeof saveCardCycleBudgetSchema
>;

export const SaveCardCycleBudgetPipe = new ZodValidationPipe(
  saveCardCycleBudgetSchema,
);
