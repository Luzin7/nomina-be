import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { right } from '@shared/core/errors/Either';
import { DismissRecurringSuggestionController } from './dismiss-recurring-suggestion.controller';
import type { DismissRecurringSuggestionService } from './dismiss-recurring-suggestion.service';

describe('DismissRecurringSuggestionController', () => {
  let service: jest.Mocked<DismissRecurringSuggestionService>;
  let controller: DismissRecurringSuggestionController;

  beforeEach(() => {
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<DismissRecurringSuggestionService>;
    controller = new DismissRecurringSuggestionController(service);
  });

  it('wraps the dismissed suggestion in the data envelope', async () => {
    service.execute.mockResolvedValue(
      right({ id: 'suggestion-1', status: 'dismissed' }),
    );

    const result = await controller.handle(
      { workspaceId: 'ws-1' } as TokenPayloadSchema,
      { id: 'suggestion-1' },
    );

    expect(result).toEqual({
      data: { id: 'suggestion-1', status: 'dismissed' },
    });
  });
});
