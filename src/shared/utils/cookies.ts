export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;

  const prefix = `${name}=`;

  for (const rawPart of cookieHeader.split(';')) {
    const part = rawPart.trim();

    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }

  return undefined;
}
