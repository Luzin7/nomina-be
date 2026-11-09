import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const allocationSchema = z.object({
  categoryId: z.string().min(1),
  groupName: z.string().trim().min(1).optional(),
  groupOrder: z.number().int().optional(),
  categoryOrder: z.number().int().optional(),
  percentageOfIncome: z.number().int().min(0).max(100),
});

const saveBudgetConfigSchema = z.object({
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
