import { isAuthorizedCronCall } from './is-authorized-cron-call';

describe('isAuthorizedCronCall', () => {
  it('rejects every call when the cron key is not configured', () => {
    expect(isAuthorizedCronCall(undefined, undefined)).toBe(false);
  });

  it('rejects every call when the cron key is configured empty', () => {
    expect(isAuthorizedCronCall('', '')).toBe(false);
  });

  it('rejects a call without the key header', () => {
    expect(isAuthorizedCronCall(undefined, 'cron-key')).toBe(false);
  });

  it('rejects a call with the wrong key', () => {
    expect(isAuthorizedCronCall('other-key', 'cron-key')).toBe(false);
  });

  it('accepts a call with the configured key', () => {
    expect(isAuthorizedCronCall('cron-key', 'cron-key')).toBe(true);
  });
});
