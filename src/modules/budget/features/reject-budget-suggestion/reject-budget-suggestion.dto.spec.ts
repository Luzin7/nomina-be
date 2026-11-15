import { BadRequestException } from '@nestjs/common';
import { RejectBudgetSuggestionPipe } from './reject-budget-suggestion.dto';

describe('RejectBudgetSuggestionPipe', () => {
  it.each(['income', 'split'])('accepts the %s kind', (kind) => {
    expect(RejectBudgetSuggestionPipe.transform({ kind })).toEqual({ kind });
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      RejectBudgetSuggestionPipe.transform({ kind: 'other' }),
    ).toThrow(BadRequestException);
  });
});
