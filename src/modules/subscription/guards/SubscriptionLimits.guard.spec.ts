import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceMemberLimitReachedError } from '../errors';
import {
  CheckSubscriptionLimitsService,
  ResourceType,
} from '../services/CheckSubscriptionLimits.service';
import { SubscriptionLimitsGuard } from './SubscriptionLimits.guard';

describe('SubscriptionLimitsGuard', () => {
  it('should answer 403 with the member limit message', async () => {
    const checkLimitsService = {
      execute: jest.fn().mockResolvedValue({
        isLeft: () => true,
        value: new WorkspaceMemberLimitReachedError(3),
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
    const guard = new SubscriptionLimitsGuard(checkLimitsService, reflector);

    const attempt = guard.canActivate(context);

    await expect(attempt).rejects.toThrow(ForbiddenException);
    await expect(attempt).rejects.toThrow(
      'Seu plano permite até 3 pessoas por workspace.',
    );
  });
});
