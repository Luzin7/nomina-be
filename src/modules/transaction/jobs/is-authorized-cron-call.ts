export const isAuthorizedCronCall = (
  received?: string,
  expected?: string,
): boolean => Boolean(expected) && received === expected;
