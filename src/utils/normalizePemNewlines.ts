export function normalizePemNewlines(pem: string): string {
  return pem.replaceAll(String.raw`\n`, '\n');
}
