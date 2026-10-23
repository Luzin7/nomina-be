const MAX_CAUSE_DEPTH = 10;
const SQL_STATE_PATTERN = /^[0-9A-Z]{5}$/;

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  cause?: unknown;
}

export interface ErrorDetails {
  sqlState: string | null;
  messageChain: string;
}

function asErrorLike(value: unknown): ErrorLike | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as ErrorLike;
}

function readMessage(error: ErrorLike): string | null {
  if (typeof error.message !== 'string') return null;

  const message = error.message.replace(/\s+/g, ' ').trim();

  return message.length > 0 ? message : null;
}

function readSqlState(error: ErrorLike): string | null {
  if (typeof error.code !== 'string') return null;

  return SQL_STATE_PATTERN.test(error.code) ? error.code : null;
}

export function getErrorDetails(error: unknown): ErrorDetails {
  const messages: string[] = [];
  const visited = new Set<ErrorLike>();
  let sqlState: string | null = null;
  let current = asErrorLike(error);

  while (current && !visited.has(current) && visited.size < MAX_CAUSE_DEPTH) {
    visited.add(current);

    const message = readMessage(current);
    if (message) messages.push(message);

    sqlState ??= readSqlState(current);

    current = asErrorLike(current.cause);
  }

  return {
    sqlState,
    messageChain: messages.length > 0 ? messages.join(' <- ') : String(error),
  };
}
