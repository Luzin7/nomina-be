import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const rejectBudgetSuggestionSchema = z.object({
  kind: z.enum(['income', 'split']),
});

export type RejectBudgetSuggestionRequest = z.infer<
  typeof rejectBudgetSuggestionSchema
>;

export const RejectBudgetSuggestionPipe = new ZodValidationPipe(
  rejectBudgetSuggestionSchema,
);
