import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const payCreditCardInvoiceSchema = z.object({
  sourceAccountId: z.string().uuid('ID da conta origem inválido'),
  amount: z.coerce.number().positive('Valor deve ser positivo'),
  description: z.string().optional().nullable(),
  // Opcional: quando o cliente não informa, o service resolve a categoria de
  // sistema `Cartão de Crédito` pelo nome. Um UUID fixo aqui só funcionaria no
  // banco onde ele por acaso existisse — o seed gera os IDs.
  categoryId: z.string().uuid('ID da categoria inválido').optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

export type PayCreditCardInvoiceRequest = z.infer<
  typeof payCreditCardInvoiceSchema
>;
export const PayCreditCardInvoicePipe = new ZodValidationPipe(
  payCreditCardInvoiceSchema,
);
