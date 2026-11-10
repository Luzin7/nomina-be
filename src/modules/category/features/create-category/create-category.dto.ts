import { TransactionType } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const createCategorySchema = z.object({
  name: z.string().trim(),
  type: z.nativeEnum(TransactionType),
  parentId: z.string().min(1).optional().nullable(),
});

export const CreateCategoryPipe = new ZodValidationPipe(createCategorySchema);
export type CreateCategoryRequest = z.infer<typeof createCategorySchema>;
