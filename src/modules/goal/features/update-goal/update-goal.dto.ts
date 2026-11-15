import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const updateGoalSchema = z.object({
  name: z.string().optional(),
  targetCents: moneySchema.optional(),
  currentCents: moneySchema.optional(),
  monthlyAporteCents: moneySchema.optional(),
  linkedAccountId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  dismissed: z.boolean().optional(),
});

const updateGoalParamsSchema = z.object({
  id: z.string().min(1),
});

export type UpdateGoalRequest = z.infer<typeof updateGoalSchema>;
export type UpdateGoalParams = z.infer<typeof updateGoalParamsSchema>;
export const UpdateGoalPipe = new ZodValidationPipe(updateGoalSchema);
export const UpdateGoalParamsPipe = new ZodValidationPipe(
  updateGoalParamsSchema,
);
