import { DrizzleQueryError } from 'drizzle-orm/errors';
import { getErrorDetails } from './error-details';

describe('getErrorDetails', () => {
  it('reads the sqlstate from a plain error', () => {
    const error = Object.assign(new Error('duplicate key value'), {
      code: '23505',
    });

    expect(getErrorDetails(error)).toEqual({
      sqlState: '23505',
      messageChain: 'duplicate key value',
    });
  });

  it('reads the sqlstate hidden behind a drizzle wrapper', () => {
    const driverError = Object.assign(
      new Error(
        'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      ),
      { code: '42P10' },
    );
    const wrapped = new DrizzleQueryError(
      'insert into "transactions" ...',
      [],
      driverError,
    );

    const details = getErrorDetails(wrapped);

    expect(details.sqlState).toBe('42P10');
    expect(details.messageChain).toContain('Failed query: insert into');
    expect(details.messageChain).toContain(
      'there is no unique or exclusion constraint matching the ON CONFLICT specification',
    );
  });

  it('walks nested causes to the deepest sqlstate', () => {
    const root = Object.assign(new Error('connection terminated'), {
      code: '08006',
    });
    const middle = new Error('pool error', { cause: root });
    const outer = new Error('job failed', { cause: middle });

    expect(getErrorDetails(outer)).toEqual({
      sqlState: '08006',
      messageChain: 'job failed <- pool error <- connection terminated',
    });
  });

  it('returns a null sqlstate but keeps the messages when there is no code', () => {
    const error = new Error('transaction date out of range');

    expect(getErrorDetails(error)).toEqual({
      sqlState: null,
      messageChain: 'transaction date out of range',
    });
  });

  it('ignores driver codes that are not sqlstate', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });

    expect(getErrorDetails(error)).toEqual({
      sqlState: null,
      messageChain: 'connect ECONNREFUSED',
    });
  });

  it('describes a thrown value that is not an error', () => {
    expect(getErrorDetails('redis down')).toEqual({
      sqlState: null,
      messageChain: 'redis down',
    });
  });
});
