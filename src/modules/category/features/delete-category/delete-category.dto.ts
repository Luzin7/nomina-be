import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const deleteCategorySchema = z.object({
  id: z.string().min(1),
});

export const DeleteCategoryPipe = new ZodValidationPipe(deleteCategorySchema);
export type DeleteCategoryRequest = z.infer<typeof deleteCategorySchema>;
