import { ZodValidationPipe } from '@shared/pipes/ZodValidation';
import { z } from 'zod';

const suggestionIdParamSchema = z.object({
  id: z.string().uuid('ID da sugestão inválido'),
});

const markSuggestionsShownSchema = z.object({
  ids: z
    .array(z.string().uuid('ID da sugestão inválido'))
    .min(1, 'Informe ao menos uma sugestão')
    .max(100, 'Muitas sugestões por requisição'),
});

const acceptSuggestionBodySchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Título é obrigatório')
      .max(120, 'Título deve ter no máximo 120 caracteres')
      .optional(),
  })
  .default({});

export const SuggestionIdParamPipe = new ZodValidationPipe(
  suggestionIdParamSchema,
);
export type SuggestionIdParam = z.infer<typeof suggestionIdParamSchema>;

export const MarkSuggestionsShownPipe = new ZodValidationPipe(
  markSuggestionsShownSchema,
);
export type MarkSuggestionsShownRequest = z.infer<
  typeof markSuggestionsShownSchema
>;

export const AcceptSuggestionBodyPipe = new ZodValidationPipe(
  acceptSuggestionBodySchema,
);
export type AcceptSuggestionBody = z.infer<typeof acceptSuggestionBodySchema>;
