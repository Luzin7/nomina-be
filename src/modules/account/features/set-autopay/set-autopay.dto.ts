import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

export const setAutopaySchema = z.object({
  enabled: z.boolean(),
  sourceAccountId: z.string().trim().min(1).optional(),
});

export const SetAutopayPipe = new ZodValidationPipe(setAutopaySchema);
export type SetAutopayRequest = z.infer<typeof setAutopaySchema>;
