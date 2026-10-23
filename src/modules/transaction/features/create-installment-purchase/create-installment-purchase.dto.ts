import { TransactionType } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { MAX_INSTALLMENTS } from '@utils/installmentSchedule';
import { z } from 'zod';

export const MIN_PURCHASE_INSTALLMENTS = 2;

const createInstallmentPurchaseSchema = z.object({
  accountId: z.string().uuid('ID da conta inválido'),
  categoryId: z.string().uuid('ID da categoria inválido'),
  title: z.string().min(1, 'Título é obrigatório'),
  description: z.string().optional().nullable(),
  totalAmount: z.coerce.bigint().positive('Valor total deve ser positivo'),
  installments: z.coerce
    .number()
    .int()
    .min(MIN_PURCHASE_INSTALLMENTS, 'Mínimo de 2 parcelas')
    .max(MAX_INSTALLMENTS, 'Máximo de 365 parcelas'),
  purchaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato deve ser YYYY-MM-DD'),
  type: z.literal(TransactionType.EXPENSE),
});

export type CreateInstallmentPurchaseRequest = z.infer<
  typeof createInstallmentPurchaseSchema
>;
export const CreateInstallmentPurchasePipe = new ZodValidationPipe(
  createInstallmentPurchaseSchema,
);
