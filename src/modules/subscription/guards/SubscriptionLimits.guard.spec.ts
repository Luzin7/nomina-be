import {
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { WorkspaceMemberLimitReachedError } from '../errors';
import {
  CheckSubscriptionLimitsService,
  ResourceType,
} from '../services/CheckSubscriptionLimits.service';
import { SubscriptionLimitsGuard } from './SubscriptionLimits.guard';

function makeGuard(leftValue: Error): {
  guard: SubscriptionLimitsGuard;
  context: ExecutionContext;
} {
  const checkLimitsService = {
    execute: jest.fn().mockResolvedValue({
      isLeft: () => true,
      value: leftValue,
    }),
  } as unknown as CheckSubscriptionLimitsService;
  const reflector = {
    get: jest.fn().mockReturnValue(ResourceType.WORKSPACE_MEMBER),
  } as unknown as Reflector;
  const context = {
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user: { sub: 'owner-1', workspaceId: 'ws-1' } }),
    }),
  } as unknown as ExecutionContext;

  return {
    guard: new SubscriptionLimitsGuard(checkLimitsService, reflector),
    context,
  };
}

describe('SubscriptionLimitsGuard', () => {
  it('should answer 403 with the member limit message and discriminator', async () => {
    const { guard, context } = makeGuard(
      new WorkspaceMemberLimitReachedError(3),
    );
    const error = await guard.canActivate(context).catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(error.getResponse()).toEqual({
      statusCode: HttpStatus.FORBIDDEN,
      message: 'Seu plano permite até 3 pessoas por workspace.',
      error: 'Forbidden',
      code: 'PLAN_LIMIT_EXCEEDED',
    });
  });

  it('should answer 403 without the discriminator for a role denial', async () => {
    const { guard, context } = makeGuard(
      new UnauthorizedError('Não é o proprietário'),
    );
    const error = await guard.canActivate(context).catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(error.getResponse()).not.toHaveProperty('code');
  });
});
