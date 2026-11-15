import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const acceptIncomeSuggestionSchema = z.object({
  fingerprint: z.string().trim().min(1),
});

export type AcceptIncomeSuggestionRequest = z.infer<
  typeof acceptIncomeSuggestionSchema
>;

export const AcceptIncomeSuggestionPipe = new ZodValidationPipe(
  acceptIncomeSuggestionSchema,
);
