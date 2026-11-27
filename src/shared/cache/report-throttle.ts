import { captureException } from '@sentry/nestjs';

const THROTTLE_INTERVAL_MS = 60_000;

const lastReportedAt = new Map<string, number>();

export function reportThrottled(
  throttleKey: string,
  error: unknown,
  context: Parameters<typeof captureException>[1],
): void {
  const now = Date.now();
  const reportedAt = lastReportedAt.get(throttleKey);
  if (reportedAt !== undefined && now - reportedAt < THROTTLE_INTERVAL_MS) {
    return;
  }

  lastReportedAt.set(throttleKey, now);
  captureException(error, context);
}

export function resetReportThrottle(): void {
  lastReportedAt.clear();
}
