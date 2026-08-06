import {
  AccountType,
  CLOSING_DAYS_BEFORE_DUE_OPTIONS,
  isValidClosingDaysBeforeDue,
  MAX_DUE_DAY,
  MIN_DUE_DAY,
} from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const baseAccountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nome é obrigatório')
    .max(100, 'Nome muito longo'),
  timezone: z.string().default('America/Sao_Paulo'),
});

export const createAccountSchema = z.discriminatedUnion('type', [
  baseAccountSchema.extend({
    type: z.literal(AccountType.CREDIT_CARD),
    creditLimit: z.coerce
      .number()
      .positive('Limite deve ser positivo')
      .optional()
      .nullable(),
    closingDaysBeforeDue: z
      .number()
      .int()
      .refine(isValidClosingDaysBeforeDue, {
        message: `Fechamento deve ser ${CLOSING_DAYS_BEFORE_DUE_OPTIONS.join(', ')} dias antes do vencimento`,
      }),
    dueDay: z.number().int().min(MIN_DUE_DAY).max(MAX_DUE_DAY),
  }),
  baseAccountSchema.extend({
    type: z.literal(AccountType.CHECKING),
    balance: z.coerce.number().optional().default(0),
  }),
  baseAccountSchema.extend({
    type: z.literal(AccountType.CASH),
    balance: z.coerce.number().optional().default(0),
  }),
]);

export type CreateAccountRequest = z.infer<typeof createAccountSchema>;
export const CreateAccountPipe = new ZodValidationPipe(createAccountSchema);
