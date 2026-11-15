import { BadRequestException } from '@nestjs/common';
import { AcceptIncomeSuggestionPipe } from './accept-income-suggestion.dto';

describe('AcceptIncomeSuggestionPipe', () => {
  it('requires a fingerprint', () => {
    expect(() => AcceptIncomeSuggestionPipe.transform({})).toThrow(
      BadRequestException,
    );
  });

  it('accepts a fingerprint', () => {
    expect(
      AcceptIncomeSuggestionPipe.transform({ fingerprint: 'abc' }),
    ).toEqual({ fingerprint: 'abc' });
  });
});
