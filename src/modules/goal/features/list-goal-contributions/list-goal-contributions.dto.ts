import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const listGoalContributionsParamsSchema = z.object({
  id: z.string().min(1),
});

export type ListGoalContributionsParams = z.infer<
  typeof listGoalContributionsParamsSchema
>;
export const ListGoalContributionsParamsPipe = new ZodValidationPipe(
  listGoalContributionsParamsSchema,
);
