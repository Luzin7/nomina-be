import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const createGoalSchema = z.object({
  name: z.string(),
  targetCents: moneySchema.positive(),
  currentCents: moneySchema.optional(),
  monthlyAporteCents: moneySchema.optional(),
  linkedAccountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
});

export type CreateGoalRequest = z.infer<typeof createGoalSchema>;
export const CreateGoalPipe = new ZodValidationPipe(createGoalSchema);
