import {
  CLOSING_DAYS_BEFORE_DUE_OPTIONS,
  isValidClosingDaysBeforeDue,
  MAX_DUE_DAY,
  MIN_DUE_DAY,
} from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

export const updateAccountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(50, 'Name is too long'),
  closingDaysBeforeDue: z
    .number()
    .int()
    .refine(isValidClosingDaysBeforeDue, {
      message: `Fechamento deve ser ${CLOSING_DAYS_BEFORE_DUE_OPTIONS.join(', ')} dias antes do vencimento`,
    })
    .optional()
    .nullable(),
  dueDay: z
    .number()
    .int()
    .min(MIN_DUE_DAY)
    .max(MAX_DUE_DAY)
    .optional()
    .nullable(),
  creditLimit: z.coerce
    .number()
    .positive('Limite deve ser positivo')
    .optional(),
});

export const UpdateAccountPipe = new ZodValidationPipe(updateAccountSchema);
export type UpdateAccountRequest = z.infer<typeof updateAccountSchema>;
