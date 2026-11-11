import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const getProjectionSchema = z.object({
  months: z.coerce.number().optional(),
});

export type GetProjectionRequest = z.infer<typeof getProjectionSchema>;

export const GetProjectionPipe = new ZodValidationPipe(getProjectionSchema);
