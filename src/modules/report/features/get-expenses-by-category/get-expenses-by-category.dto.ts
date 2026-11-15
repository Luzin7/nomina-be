import { MAX_REPORT_YEAR, MIN_REPORT_YEAR } from '@constants/reportYear';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const TOP_CATEGORIES_LIMIT = 5;

const expensesByCategorySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(MIN_REPORT_YEAR).max(MAX_REPORT_YEAR),
  limit: z.coerce.number().int().min(1).max(50).default(TOP_CATEGORIES_LIMIT),
});

export type GetExpensesByCategoryRequest = z.infer<
  typeof expensesByCategorySchema
>;

export const GetExpensesByCategoryPipe = new ZodValidationPipe(
  expensesByCategorySchema,
);
