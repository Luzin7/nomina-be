import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const payCreditCardInvoiceSchema = z.object({
  sourceAccountId: z.string().uuid('ID da conta origem inválido'),
  amount: z.coerce.number().positive('Valor deve ser positivo'),
  description: z.string().optional().nullable(),
  categoryId: z
    .string()
    .uuid('ID da categoria inválido')
    .default('0d19bbf8-b66a-4cc2-9c7c-3fcd961f06b1'),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

export type PayCreditCardInvoiceRequest = z.infer<
  typeof payCreditCardInvoiceSchema
>;
export const PayCreditCardInvoicePipe = new ZodValidationPipe(
  payCreditCardInvoiceSchema,
);
