export const errorClassOf = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError';
