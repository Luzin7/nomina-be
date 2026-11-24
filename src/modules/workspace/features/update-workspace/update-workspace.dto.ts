import { WORKSPACE_CYCLE_OPTIONS } from '@constants/enums';
import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

export const updateWorkspaceBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nome é obrigatório')
    .max(100, 'Nome muito longo'),
  currency: z
    .string()
    .trim()
    .length(3, 'Moeda deve ter 3 caracteres (ex: BRL)')
    .optional(),
  cycle: z.enum(WORKSPACE_CYCLE_OPTIONS).optional(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const updateWorkspaceParamsSchema = z.object({
  workspaceId: z
    .string({ required_error: 'workspaceId é obrigatório' })
    .uuid('workspaceId deve ser um UUID válido'),
});

export const UpdateWorkspaceBodyPipe = new ZodValidationPipe(
  updateWorkspaceBodySchema,
);
export type UpdateWorkspaceBodyRequest = z.infer<
  typeof updateWorkspaceBodySchema
>;
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceBodySchema> &
  z.infer<typeof updateWorkspaceParamsSchema>;
