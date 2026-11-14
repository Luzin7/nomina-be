import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const updateCategorySchema = z.object({
  name: z.string().trim().optional(),
  isHidden: z.boolean().optional(),
});

const updateCategoryParamsSchema = z.object({
  id: z.string().min(1),
});

export const UpdateCategoryPipe = new ZodValidationPipe(updateCategorySchema);
export const UpdateCategoryParamsPipe = new ZodValidationPipe(
  updateCategoryParamsSchema,
);
export type UpdateCategoryRequest = z.infer<typeof updateCategorySchema>;
export type UpdateCategoryParams = z.infer<typeof updateCategoryParamsSchema>;
