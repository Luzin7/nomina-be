import { TransactionType } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const listCategoriesSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive('Página deve ser um número positivo')
    .default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive('Tamanho da página deve ser um número positivo')
    .max(100, 'Tamanho da página muito grande')
    .default(20),
  type: z.nativeEnum(TransactionType).optional(),
  parentId: z.string().optional(),
});

export const ListCategoriesPipe = new ZodValidationPipe(listCategoriesSchema);
export type ListCategoriesRequest = z.infer<typeof listCategoriesSchema>;
