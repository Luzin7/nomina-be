import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const createGoalContributionSchema = z.object({
  id: z.string().uuid(),
  amountCents: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sourceAccountId: z.string().min(1).optional(),
});

const createGoalContributionParamsSchema = z.object({
  id: z.string().min(1),
});

export type CreateGoalContributionRequest = z.infer<
  typeof createGoalContributionSchema
>;
export type CreateGoalContributionParams = z.infer<
  typeof createGoalContributionParamsSchema
>;
export const CreateGoalContributionPipe = new ZodValidationPipe(
  createGoalContributionSchema,
);
export const CreateGoalContributionParamsPipe = new ZodValidationPipe(
  createGoalContributionParamsSchema,
);
