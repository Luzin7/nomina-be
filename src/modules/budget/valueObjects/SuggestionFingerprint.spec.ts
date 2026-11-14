import { fingerprintOf } from './SuggestionFingerprint';

describe('fingerprintOf', () => {
  it('is stable for equal payloads', () => {
    expect(fingerprintOf({ incomeCents: 100, base: 'median' })).toBe(
      fingerprintOf({ incomeCents: 100, base: 'median' }),
    );
  });

  it('changes when any value changes', () => {
    expect(fingerprintOf({ incomeCents: 100 })).not.toBe(
      fingerprintOf({ incomeCents: 101 }),
    );
  });

  it('has 32 hex characters', () => {
    expect(fingerprintOf({})).toMatch(/^[0-9a-f]{32}$/);
  });
});
