import { CycleWindow } from './CycleWindow';

const TODAY = '2026-11-15';

describe('CycleWindow', () => {
  it('covers the calendar month', () => {
    const window = CycleWindow.of(TODAY, 'monthly');

    expect(window.startDate).toBe('2026-11-01');
    expect(window.endDate).toBe('2026-11-30');
    expect(window.daysRemaining).toBe(16);
  });

  it('closes the month on its last day', () => {
    const window = CycleWindow.of('2026-02-10', 'monthly');

    expect(window.endDate).toBe('2026-02-28');
  });

  it('covers the first half of the month', () => {
    const window = CycleWindow.of('2026-11-03', 'half_month');

    expect(window.startDate).toBe('2026-11-01');
    expect(window.endDate).toBe('2026-11-15');
    expect(window.daysRemaining).toBe(13);
  });

  it('covers the second half of the month', () => {
    const window = CycleWindow.of('2026-11-20', 'half_month');

    expect(window.startDate).toBe('2026-11-16');
    expect(window.endDate).toBe('2026-11-30');
    expect(window.daysRemaining).toBe(11);
  });

  it('splits the half month on the fifteenth', () => {
    expect(CycleWindow.of('2026-11-15', 'half_month').endDate).toBe(
      '2026-11-15',
    );
    expect(CycleWindow.of('2026-11-16', 'half_month').startDate).toBe(
      '2026-11-16',
    );
  });

  it('covers the week from monday to sunday', () => {
    const window = CycleWindow.of('2026-11-24', 'weekly');

    expect(window.startDate).toBe('2026-11-23');
    expect(window.endDate).toBe('2026-11-29');
    expect(window.daysRemaining).toBe(6);
  });

  it('crosses the month on a week that starts before it', () => {
    const window = CycleWindow.of('2026-12-01', 'weekly');

    expect(window.startDate).toBe('2026-11-30');
    expect(window.endDate).toBe('2026-12-06');
  });

  it('keeps sunday inside the week that started on monday', () => {
    const window = CycleWindow.of('2026-11-29', 'weekly');

    expect(window.startDate).toBe('2026-11-23');
    expect(window.daysRemaining).toBe(1);
  });

  it('counts the last day as remaining', () => {
    expect(CycleWindow.of('2026-11-30', 'monthly').daysRemaining).toBe(1);
  });

  it('contains only dates inside its bounds', () => {
    const window = CycleWindow.of(TODAY, 'monthly');

    expect(window.contains('2026-11-01')).toBe(true);
    expect(window.contains('2026-11-30')).toBe(true);
    expect(window.contains('2026-12-01')).toBe(false);
  });
});
