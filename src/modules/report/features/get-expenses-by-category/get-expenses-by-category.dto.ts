import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const TOP_CATEGORIES_LIMIT = 5;

const expensesByCategorySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2026).max(2100),
  limit: z.coerce.number().int().min(1).max(50).default(TOP_CATEGORIES_LIMIT),
});

export type GetExpensesByCategoryRequest = z.infer<
  typeof expensesByCategorySchema
>;

export const GetExpensesByCategoryPipe = new ZodValidationPipe(
  expensesByCategorySchema,
);
