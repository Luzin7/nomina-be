import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
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
import {
  PlanLimitReachedError,
  SubscriptionNotActiveError,
  WorkspaceMemberLimitReachedError,
} from '@modules/subscription/errors';
import { InviteExpiredError } from '@modules/workspace/errors';
import { SessionExpiredError } from '@shared/errors/SessionExpiredError';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { ErrorPresenter } from './ErrorPresenter';

function catchHttpException(attempt: () => void): HttpException {
  try {
    attempt();
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('expected an HttpException');
}

const PLAN_LIMIT_ERRORS: Array<[string, Error]> = [
  ['PlanLimitReachedError', new PlanLimitReachedError(5, 3)],
  [
    'WorkspaceMemberLimitReachedError',
    new WorkspaceMemberLimitReachedError(10),
  ],
  ['SubscriptionNotActiveError', new SubscriptionNotActiveError()],
];

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

  it.each(PLAN_LIMIT_ERRORS)(
    'should answer 403 with the plan limit discriminator for %s',
    (_name, error) => {
      const exception = catchHttpException(() => ErrorPresenter.toHTTP(error));

      expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect(exception.getResponse()).toEqual({
        statusCode: HttpStatus.FORBIDDEN,
        message: error.message,
        error: 'Forbidden',
        code: 'PLAN_LIMIT_EXCEEDED',
      });
    },
  );

  it('should answer 403 without the discriminator for a role denial', () => {
    const exception = catchHttpException(() =>
      ErrorPresenter.toHTTP(new UnauthorizedError()),
    );

    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(exception.getResponse()).not.toHaveProperty('code');
  });

  it('should throw GoneException for a GoneDomainError', () => {
    expect(() => ErrorPresenter.toHTTP(new InviteExpiredError())).toThrow(
      GoneException,
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
