export class UnresolvableLocalTimeError extends Error {
  constructor(input: { timezone: string; wallClock: string }) {
    super(
      `wall clock "${input.wallClock}" cannot be resolved in timezone "${input.timezone}"`,
    );
    this.name = 'UnresolvableLocalTimeError';
  }
}
