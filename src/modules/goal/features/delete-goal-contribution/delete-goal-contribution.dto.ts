import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const deleteGoalContributionParamsSchema = z.object({
  id: z.string().min(1),
  contributionId: z.string().min(1),
});

export type DeleteGoalContributionParams = z.infer<
  typeof deleteGoalContributionParamsSchema
>;
export const DeleteGoalContributionParamsPipe = new ZodValidationPipe(
  deleteGoalContributionParamsSchema,
);
