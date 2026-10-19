import { UnsafeMigrationTargetError } from '@infra/databases/drizzle/errors/UnsafeMigrationTargetError';
import {
  allowRemoteMigrationTarget,
  assertSafeMigrationTarget,
} from './assert-safe-migration-target';

const NEON_URL =
  'postgresql://user:s3cret@ep-guardtest.us-west-2.aws.neon.tech:5432/neondb';
const NEON_HOST = 'ep-guardtest.us-west-2.aws.neon.tech';

describe('assertSafeMigrationTarget', () => {
  it.each([
    'postgresql://user:password@localhost:5432/nomina_db',
    'postgresql://user:password@localhost.:5432/nomina_db',
    'postgresql://user:password@127.0.0.1:5432/nomina_db',
    'postgresql://user:password@[::1]:5432/nomina_db',
    'postgresql://user:password@0.0.0.0:5432/nomina_db',
    'postgresql://user:password@host.docker.internal:5432/nomina_db',
    'postgresql://user:password@postgres:5432/nomina_db',
    'postgresql://user:password@db:5432/nomina_db',
    'postgresql://user:password@app.localhost:5432/nomina_db',
    'postgresql://user:password@db.local:5432/nomina_db',
  ])('allows the local target %s', (databaseUrl) => {
    expect(() =>
      assertSafeMigrationTarget({ databaseUrl, allowProd: false }),
    ).not.toThrow();
  });

  it.each([
    NEON_URL,
    'postgresql://user:password@db.example.com:5432/nomina_db',
    'postgresql://user:password@EP-EXAMPLE.US-WEST-2.AWS.NEON.TECH.:5432/neondb',
  ])('rejects the remote target %s by default', (databaseUrl) => {
    expect(() =>
      assertSafeMigrationTarget({ databaseUrl, allowProd: false }),
    ).toThrow(UnsafeMigrationTargetError);
  });

  it('accepts a remote target when allowProd is true', () => {
    expect(() =>
      assertSafeMigrationTarget({ databaseUrl: NEON_URL, allowProd: true }),
    ).not.toThrow();
  });

  it.each([
    { CI: 'true' },
    { ALLOW_PROD_MIGRATE: '1' },
    { CI: 'true', ALLOW_PROD_MIGRATE: '1' },
  ])('allows remote migration targets for env %o', (env) => {
    expect(allowRemoteMigrationTarget(env)).toBe(true);
  });

  it.each([{ CI: 'false' }, { CI: 'TRUE' }])(
    'refuses remote migration targets for env %o',
    (env) => {
      expect(allowRemoteMigrationTarget(env)).toBe(false);
    },
  );

  it('rejects an unparseable URL', () => {
    expect(() =>
      assertSafeMigrationTarget({
        databaseUrl: 'not-a-valid-url',
        allowProd: false,
      }),
    ).toThrow(UnsafeMigrationTargetError);
  });

  it('names the host without leaking the password or the full URL', () => {
    let captured: Error | undefined;
    try {
      assertSafeMigrationTarget({ databaseUrl: NEON_URL, allowProd: false });
    } catch (error) {
      captured = error as Error;
    }

    expect(captured).toBeInstanceOf(UnsafeMigrationTargetError);
    expect(captured?.message).toContain(NEON_HOST);
    expect(captured?.message).not.toContain('s3cret');
    expect(captured?.message).not.toContain(NEON_URL);
  });
});
