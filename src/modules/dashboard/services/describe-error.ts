export const describeError = (error: unknown): string =>
  error instanceof Error
    ? `${error.constructor.name}: ${error.message}`
    : typeof error;
