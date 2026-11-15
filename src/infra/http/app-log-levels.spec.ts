import { APP_LOG_LEVELS } from './app-log-levels';

describe('APP_LOG_LEVELS', () => {
  it('includes the levels error, warn and log', () => {
    expect(APP_LOG_LEVELS).toEqual(
      expect.arrayContaining(['error', 'warn', 'log']),
    );
  });
});
