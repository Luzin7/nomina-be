import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const getBudgetSetupSchema = z.object({});

export type GetBudgetSetupRequest = z.infer<typeof getBudgetSetupSchema>;

export const GetBudgetSetupPipe = new ZodValidationPipe(getBudgetSetupSchema);
