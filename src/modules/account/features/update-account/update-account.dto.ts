import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const updateAccountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(50, 'Name is too long'),
  closingDaysBeforeDue: z.number().int().min(5).max(10).optional().nullable(),
  dueDay: z.number().int().min(1).max(28).optional().nullable(),
  creditLimit: z.coerce
    .number()
    .positive('Limite deve ser positivo')
    .optional(),
});

export const UpdateAccountPipe = new ZodValidationPipe(updateAccountSchema);
export type UpdateAccountRequest = z.infer<typeof updateAccountSchema>;
