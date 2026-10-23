import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AccountNotFoundError,
  AccountTypeError,
  ConflictAccountError,
} from '@modules/account/errors';
import { SessionExpiredError } from '@shared/errors/SessionExpiredError';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { ErrorPresenter } from './ErrorPresenter';

describe('ErrorPresenter', () => {
  it('should throw UnauthorizedException for an UnauthorizedDomainError', () => {
    expect(() => ErrorPresenter.toHTTP(new SessionExpiredError())).toThrow(
      UnauthorizedException,
    );
  });

  it('should throw ForbiddenException for a ForbiddenDomainError', () => {
    expect(() => ErrorPresenter.toHTTP(new UnauthorizedError())).toThrow(
      ForbiddenException,
    );
  });

  it('should keep mapping not found, conflict and business rule errors', () => {
    expect(() => ErrorPresenter.toHTTP(new AccountNotFoundError())).toThrow(
      NotFoundException,
    );
    expect(() =>
      ErrorPresenter.toHTTP(new ConflictAccountError('duplicada')),
    ).toThrow(ConflictException);
    expect(() => ErrorPresenter.toHTTP(new AccountTypeError())).toThrow(
      UnprocessableEntityException,
    );
  });

  it('should throw InternalServerErrorException for an unmapped error', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    expect(() => ErrorPresenter.toHTTP(new Error('boom'))).toThrow(
      InternalServerErrorException,
    );
  });
});
