import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const getCardCyclePeriodsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(36).default(12),
});

export type GetCardCyclePeriodsRequest = z.infer<
  typeof getCardCyclePeriodsSchema
>;

export const GetCardCyclePeriodsPipe = new ZodValidationPipe(
  getCardCyclePeriodsSchema,
);
