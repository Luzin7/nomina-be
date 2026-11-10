import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { right } from '@shared/core/errors/Either';
import { AcceptRecurringSuggestionController } from './accept-recurring-suggestion.controller';
import type { AcceptRecurringSuggestionService } from './accept-recurring-suggestion.service';

describe('AcceptRecurringSuggestionController', () => {
  let service: jest.Mocked<AcceptRecurringSuggestionService>;
  let controller: AcceptRecurringSuggestionController;

  beforeEach(() => {
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<AcceptRecurringSuggestionService>;
    controller = new AcceptRecurringSuggestionController(service);
  });

  it('wraps the recurring id in the data envelope', async () => {
    service.execute.mockResolvedValue(right({ recurringId: 'rec-1' }));

    const result = await controller.handle(
      { workspaceId: 'ws-1' } as TokenPayloadSchema,
      { id: 'suggestion-1' },
      {},
    );

    expect(result).toEqual({ data: { recurringId: 'rec-1' } });
  });
});
