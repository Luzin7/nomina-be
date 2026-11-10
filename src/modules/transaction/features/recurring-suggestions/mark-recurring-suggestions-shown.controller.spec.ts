import { type TokenPayloadSchema } from '@providers/auth/strategys/jwtStrategy';
import { right } from '@shared/core/errors/Either';
import { MarkRecurringSuggestionsShownController } from './mark-recurring-suggestions-shown.controller';
import type { MarkRecurringSuggestionsShownService } from './mark-recurring-suggestions-shown.service';

describe('MarkRecurringSuggestionsShownController', () => {
  let service: jest.Mocked<MarkRecurringSuggestionsShownService>;
  let controller: MarkRecurringSuggestionsShownController;

  beforeEach(() => {
    service = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<MarkRecurringSuggestionsShownService>;
    controller = new MarkRecurringSuggestionsShownController(service);
  });

  it('wraps the shown ids in the data envelope', async () => {
    service.execute.mockResolvedValue(right({ ids: ['suggestion-1'] }));

    const result = await controller.handle(
      { workspaceId: 'ws-1' } as TokenPayloadSchema,
      { ids: ['suggestion-1'] },
    );

    expect(result).toEqual({ data: { ids: ['suggestion-1'] } });
  });
});
