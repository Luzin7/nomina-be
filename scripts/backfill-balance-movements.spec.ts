import * as Sentry from '@sentry/nestjs';
import type postgres from 'postgres';
import { BALANCE_BACKFILL_ACTOR } from '../src/constants/actors';
import { BalanceMovementCause } from '../src/constants/enums';
import {
  AccountSnapshot,
  BackfillAccountsFailedError,
  alertBackfillFailure,
  insertOpening,
  reportFailedAccounts,
  reportFatalFailure,
} from './backfill-balance-movements';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
}));

const captureException = Sentry.captureException as jest.Mock;
const flush = Sentry.flush as jest.Mock;

function makeAccount(): AccountSnapshot {
  return {
    id: 'acc-1',
    workspaceId: 'ws-1',
    name: 'Checking',
    balance: 10_000n,
    effects: 4_000n,
    existing: 0n,
    opening: 6_000n,
    hasOpening: false,
  };
}

function captureSqlValues(): {
  sql: postgres.ISql;
  values: unknown[];
} {
  const values: unknown[] = [];
  const sql = ((
    _strings: TemplateStringsArray,
    ...args: unknown[]
  ): Promise<unknown[]> => {
    values.push(...args);
    return Promise.resolve([]);
  }) as unknown as postgres.ISql;

  return { sql, values };
}

describe('backfill balance movements failure path', () => {
  const originalDsn = process.env.SENTRY_DSN;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENTRY_DSN = 'https://public@sentry.example/1';
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.env.SENTRY_DSN = originalDsn;
    process.exitCode = originalExitCode;
  });

  it('sends the failure to Sentry and flushes before exiting', async () => {
    const failures = [{ id: 'acc-1', reason: 'ledger mismatch' }];

    await reportFailedAccounts(failures);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BackfillAccountsFailedError),
      { extra: { failedAccounts: failures } },
    );
    expect(flush).toHaveBeenCalledWith(2_000);
    expect(process.exitCode).toBe(1);
  });

  it('reports a fatal error to Sentry before exiting', async () => {
    const error = new Error('database is unreachable');

    await reportFatalFailure(error);

    expect(captureException).toHaveBeenCalledWith(error, undefined);
    expect(flush).toHaveBeenCalledWith(2_000);
    expect(process.exitCode).toBe(1);
  });

  it('warns instead of silently dropping the alert when the DSN is missing', async () => {
    delete process.env.SENTRY_DSN;
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await alertBackfillFailure(new Error('boom'));

    expect(captureException).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('SENTRY_DSN is not set'),
    );
    consoleError.mockRestore();
  });

  it('warns when the Sentry flush times out', async () => {
    flush.mockResolvedValueOnce(false);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await alertBackfillFailure(new Error('boom'));

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('flush timed out'),
    );
    consoleError.mockRestore();
  });

  it('writes the opening movement with the backfill system actor', async () => {
    const { sql, values } = captureSqlValues();

    await insertOpening(sql, makeAccount());

    expect(values).toContain(BalanceMovementCause.OPENING);
    expect(values).toContain(BALANCE_BACKFILL_ACTOR);
    expect(values).not.toContain(null);
  });
});
