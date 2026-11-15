import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const getCardCycleStatusSchema = z.object({
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type GetCardCycleStatusRequest = z.infer<
  typeof getCardCycleStatusSchema
>;

export const GetCardCycleStatusPipe = new ZodValidationPipe(
  getCardCycleStatusSchema,
);
