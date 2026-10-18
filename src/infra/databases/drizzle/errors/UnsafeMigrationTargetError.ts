export class UnsafeMigrationTargetError extends Error {
  constructor(host: string) {
    super(
      `drizzle-kit refuses to run against the non-local host "${host}". Set ALLOW_PROD_MIGRATE=1 to allow it.`,
    );
    this.name = 'UnsafeMigrationTargetError';
  }
}
