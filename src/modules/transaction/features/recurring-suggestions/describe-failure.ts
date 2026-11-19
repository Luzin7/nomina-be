import { DomainError } from '@shared/core/errors/DomainError';

const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return 'UnknownError';
  if (error instanceof DomainError) return `${error.name}: ${error.message}`;
  return error.constructor.name;
};

export const describeFailure = (error: unknown): string => {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!cause) return describeError(error);
  return `${describeError(error)} (cause: ${describeError(cause)})`;
};
