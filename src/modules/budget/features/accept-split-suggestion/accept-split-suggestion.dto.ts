import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const acceptSplitSuggestionSchema = z.object({
  fingerprint: z.string().trim().min(1),
});

export type AcceptSplitSuggestionRequest = z.infer<
  typeof acceptSplitSuggestionSchema
>;

export const AcceptSplitSuggestionPipe = new ZodValidationPipe(
  acceptSplitSuggestionSchema,
);
