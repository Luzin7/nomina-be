import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const getBudgetStatusSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2026).max(2100),
});

export type GetBudgetStatusRequest = z.infer<typeof getBudgetStatusSchema>;

export const GetBudgetStatusPipe = new ZodValidationPipe(getBudgetStatusSchema);
