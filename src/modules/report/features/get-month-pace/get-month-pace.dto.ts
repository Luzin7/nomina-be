import { MAX_REPORT_YEAR, MIN_REPORT_YEAR } from '@constants/reportYear';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const monthPaceSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(MIN_REPORT_YEAR).max(MAX_REPORT_YEAR),
});

export type GetMonthPaceRequest = z.infer<typeof monthPaceSchema>;

export const GetMonthPacePipe = new ZodValidationPipe(monthPaceSchema);
