import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const editedAllocationSchema = z.object({
  categoryId: z.string().min(1),
  targetCents: z.number().finite().max(Number.MAX_SAFE_INTEGER),
});

const acceptSplitSuggestionSchema = z.object({
  fingerprint: z.string().trim().min(1),
  allocations: z.array(editedAllocationSchema).optional(),
});

export type AcceptSplitSuggestionRequest = z.infer<
  typeof acceptSplitSuggestionSchema
>;

export const AcceptSplitSuggestionPipe = new ZodValidationPipe(
  acceptSplitSuggestionSchema,
);
