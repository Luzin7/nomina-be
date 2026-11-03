import { UserRole } from '@constants/enums';
import * as Sentry from '@sentry/nestjs';
import { JwtStrategy, TokenPayloadSchema } from './jwtStrategy';

describe('JwtStrategy', () => {
  const payload: TokenPayloadSchema = {
    sub: '0b0e5c3e-6a53-4c43-9a55-0d3f0e1f6b11',
    workspaceId: '5a1d7c0e-2f7b-4f0a-8d51-3f4c5b6a7d88',
    role: UserRole.OWNER,
  };

  it('should set only the user id on the Sentry scope', () => {
    const strategy = new JwtStrategy();

    Sentry.withIsolationScope(() => {
      strategy.validate(payload);

      expect(Sentry.getIsolationScope().getUser()).toEqual({ id: payload.sub });
    });
  });

  it('should tag the Sentry scope with the workspace id', () => {
    const strategy = new JwtStrategy();

    Sentry.withIsolationScope(() => {
      strategy.validate(payload);

      expect(Sentry.getIsolationScope().getScopeData().tags).toMatchObject({
        'workspace.id': payload.workspaceId,
      });
    });
  });
});
