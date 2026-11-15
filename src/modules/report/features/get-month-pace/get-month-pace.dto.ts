import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const monthPaceSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2026).max(2100),
});

export type GetMonthPaceRequest = z.infer<typeof monthPaceSchema>;

export const GetMonthPacePipe = new ZodValidationPipe(monthPaceSchema);
