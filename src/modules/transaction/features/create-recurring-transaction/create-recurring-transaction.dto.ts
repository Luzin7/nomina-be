import { RecurrenceFrequency, TransactionType } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const createRecurringTransactionSchema = z
  .object({
    accountId: z.string().uuid('ID da conta inválido'),
    categoryId: z.string().uuid('ID da categoria inválido'),
    title: z.string().min(1, 'Título é obrigatório'),
    description: z.string().optional().nullable(),
    amount: z.coerce.bigint().positive('Valor deve ser positivo').optional(),
    totalAmount: z.coerce
      .bigint()
      .positive('Valor total deve ser positivo')
      .optional(),
    installments: z.coerce
      .number()
      .int()
      .positive('Número de parcelas deve ser positivo')
      .max(365)
      .optional(),
    frequency: z.nativeEnum(RecurrenceFrequency),
    type: z.nativeEnum(TransactionType),
    interval: z.coerce
      .number()
      .int()
      .positive('Intervalo deve ser um número positivo')
      .max(365),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato deve ser YYYY-MM-DD'),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato deve ser YYYY-MM-DD')
      .optional()
      .nullable(),
    active: z.boolean().optional(),
    destinationAccountId: z.string().uuid().optional().nullable(),
  })
  .refine(
    (data) =>
      data.type === TransactionType.TRANSFER
        ? !!data.destinationAccountId
        : true,
    {
      message: 'Conta destino é obrigatória para transferências',
      path: ['destinationAccountId'],
    },
  )
  .refine(
    (data) =>
      data.amount !== undefined ||
      (data.totalAmount !== undefined && data.installments !== undefined),
    {
      message: 'Informe amount ou totalAmount + installments',
      path: ['amount'],
    },
  )
  .refine(
    (data) =>
      !(
        data.amount !== undefined &&
        (data.totalAmount !== undefined || data.installments !== undefined)
      ),
    {
      message:
        'Não é possível informar amount junto com totalAmount/installments',
      path: ['amount'],
    },
  )
  .refine(
    (data) =>
      (data.totalAmount !== undefined) === (data.installments !== undefined),
    {
      message: 'totalAmount e installments devem ser informados juntos',
      path: ['installments'],
    },
  );

export type CreateRecurringTransactionRequest = z.infer<
  typeof createRecurringTransactionSchema
>;
export const CreateRecurringTransactionPipe = new ZodValidationPipe(
  createRecurringTransactionSchema,
);
