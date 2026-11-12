import { BUDGET_MODE_DEFAULT, BUDGET_MODES } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const allocationSchema = z.object({
  categoryId: z.string().min(1),
  groupName: z.string().trim().min(1).optional(),
  groupOrder: z.number().int().optional(),
  categoryOrder: z.number().int().optional(),
  percentageOfIncome: z.number().int().min(0).max(100).optional(),
  targetCents: z.number().finite().max(Number.MAX_SAFE_INTEGER).optional(),
});

const saveBudgetConfigSchema = z.object({
  mode: z.enum(BUDGET_MODES).default(BUDGET_MODE_DEFAULT),
  monthlyIncome: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
  effectiveFrom: z.string().optional(),
  allocations: z.array(allocationSchema).default([]),
});

export type SaveBudgetConfigRequest = z.infer<typeof saveBudgetConfigSchema>;

export const SaveBudgetConfigPipe = new ZodValidationPipe(
  saveBudgetConfigSchema,
);
