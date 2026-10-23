import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common/interfaces/features/arguments-host.interface';
import { AllExceptionsFilter } from './AllExceptions.filter';

function makeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/accounts' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

function makePostgresError(code: string): Error {
  return Object.assign(new Error('postgres failure'), { code });
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    filter = new AllExceptionsFilter();
  });

  afterEach(() => jest.restoreAllMocks());

  it('should map 55P03 to 503', () => {
    const { host, status, json } = makeHost();

    filter.catch(makePostgresError('55P03'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith({
      statusCode: 503,
      message: 'Service temporarily unavailable',
      path: '/accounts',
    });
  });

  it('should map 57014 nested in the cause chain to 503', () => {
    const { host, status, json } = makeHost();
    const error = new Error('wrapped', {
      cause: makePostgresError('57014'),
    });

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith({
      statusCode: 503,
      message: 'Service temporarily unavailable',
      path: '/accounts',
    });
  });

  it('should map a plain Error to 500', () => {
    const { host, status, json } = makeHost();

    filter.catch(new Error('bug'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
      path: '/accounts',
    });
  });

  it('should keep HttpException status untouched', () => {
    const { host, status, json } = makeHost();
    const exception = new HttpException('Account not found', 404);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(exception.getResponse());
  });
});
