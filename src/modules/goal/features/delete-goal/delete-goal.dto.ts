import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const deleteGoalParamsSchema = z.object({
  id: z.string().min(1),
});

export type DeleteGoalParams = z.infer<typeof deleteGoalParamsSchema>;
export const DeleteGoalParamsPipe = new ZodValidationPipe(
  deleteGoalParamsSchema,
);
