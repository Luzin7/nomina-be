import { AcceptSuggestionBodyPipe } from './recurring-suggestion.dto';

describe('AcceptSuggestionBodyPipe', () => {
  it('defaults to an empty body when none is sent', () => {
    expect(AcceptSuggestionBodyPipe.transform(undefined)).toEqual({});
  });

  it('trims the title', () => {
    expect(
      AcceptSuggestionBodyPipe.transform({ title: '  Aluguel ajustado  ' }),
    ).toEqual({ title: 'Aluguel ajustado' });
  });

  it('rejects a blank title', () => {
    expect(() =>
      AcceptSuggestionBodyPipe.transform({ title: '   ' }),
    ).toThrow();
  });

  it('rejects a title longer than 120 characters', () => {
    expect(() =>
      AcceptSuggestionBodyPipe.transform({ title: 'a'.repeat(121) }),
    ).toThrow();
  });

  it('accepts a title with 120 characters', () => {
    const title = 'a'.repeat(120);

    expect(AcceptSuggestionBodyPipe.transform({ title })).toEqual({ title });
  });
});
