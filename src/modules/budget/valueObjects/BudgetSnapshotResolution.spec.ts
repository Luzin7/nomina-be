import { pickApplicableSnapshot } from './BudgetSnapshotResolution';

const january = {
  effectiveFrom: new Date('2026-01-01T03:00:00.000Z'),
  id: 'jan',
};
const march = {
  effectiveFrom: new Date('2026-03-01T03:00:00.000Z'),
  id: 'mar',
};

describe('pickApplicableSnapshot', () => {
  it('returns the snapshot at the requested month', () => {
    expect(
      pickApplicableSnapshot(
        [january, march],
        new Date('2026-03-01T03:00:00.000Z'),
      ),
    ).toEqual(march);
  });

  it('carries the previous snapshot forward to a month without its own snapshot', () => {
    expect(
      pickApplicableSnapshot(
        [january, march],
        new Date('2026-02-01T03:00:00.000Z'),
      ),
    ).toEqual(january);
  });

  it('returns the latest snapshot before the requested month', () => {
    expect(
      pickApplicableSnapshot(
        [march, january],
        new Date('2026-04-01T03:00:00.000Z'),
      ),
    ).toEqual(march);
  });

  it('returns null when every snapshot is after the requested month', () => {
    expect(
      pickApplicableSnapshot(
        [january, march],
        new Date('2025-12-01T03:00:00.000Z'),
      ),
    ).toBeNull();
  });

  it('returns null when there is no snapshot', () => {
    expect(
      pickApplicableSnapshot([], new Date('2026-01-01T03:00:00.000Z')),
    ).toBeNull();
  });
});
