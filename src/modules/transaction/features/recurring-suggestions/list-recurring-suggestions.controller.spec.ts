import { makeSuggestion } from '@modules/transaction/test-helpers/mock-factories';
import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { right } from '@shared/core/errors/Either';
import { ListRecurringSuggestionsController } from './list-recurring-suggestions.controller';
import type { ListRecurringSuggestionsService } from './list-recurring-suggestions.service';

describe('ListRecurringSuggestionsController', () => {
  let service: jest.Mocked<ListRecurringSuggestionsService>;
  let controller: ListRecurringSuggestionsController;

  beforeEach(() => {
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ListRecurringSuggestionsService>;
    controller = new ListRecurringSuggestionsController(service);
  });

  it('wraps the suggestions in the data envelope', async () => {
    const suggestion = makeSuggestion();
    service.execute.mockResolvedValue(
      right({
        suggestions: [
          {
            suggestion,
            categoryName: 'Moradia',
            accountName: 'Conta corrente',
          },
        ],
      }),
    );

    const result = await controller.handle({
      workspaceId: 'ws-1',
    } as TokenPayloadSchema);

    expect(result).toEqual({
      data: {
        suggestions: [
          {
            id: 'suggestion-1',
            categoryId: 'cat-1',
            categoryName: 'Moradia',
            accountId: 'acc-1',
            accountName: 'Conta corrente',
            suggestedTitle: 'Aluguel',
            amount: 150000,
            dayOfMonth: 5,
            shownAt: null,
            createdAt: new Date('2026-10-01T00:00:00.000Z'),
          },
        ],
      },
    });
  });
});
