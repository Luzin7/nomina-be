import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const adjustAccountBalanceSchema = z.object({
  id: z.string().uuid('ID do ajuste inválido'),
  expectedBalanceCents: z
    .number()
    .int('O saldo esperado deve ser inteiro')
    .safe('O saldo esperado é inválido'),
  targetBalanceCents: z
    .number()
    .int('O novo saldo deve ser inteiro')
    .safe('O novo saldo é inválido'),
});

export type AdjustAccountBalanceRequest = z.infer<
  typeof adjustAccountBalanceSchema
>;
export const AdjustAccountBalancePipe = new ZodValidationPipe(
  adjustAccountBalanceSchema,
);
