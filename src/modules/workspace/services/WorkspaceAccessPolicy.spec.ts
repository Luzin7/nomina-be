import { UserRole } from '@constants/enums';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { UnauthorizedError } from '@shared/errors/UnauthorizedError';
import { WorkspaceAccessPolicy } from './WorkspaceAccessPolicy';

const ALLOWED = [UserRole.OWNER, UserRole.ADMIN];

function makeMembership(role: UserRole): WorkspaceUser {
  const r = WorkspaceUser.create({
    workspaceId: 'ws-1',
    userId: 'user-1',
    role,
    isDefault: false,
  });
  if (r.isLeft()) throw r.value;
  return r.value;
}

describe('WorkspaceAccessPolicy', () => {
  let policy: WorkspaceAccessPolicy;

  beforeEach(() => {
    policy = new WorkspaceAccessPolicy();
  });

  it('refuses a null membership with UnauthorizedError', () => {
    const result = policy.requireRole(null, ALLOWED);

    expect(result.isLeft()).toBe(true);
    if (result.isLeft()) expect(result.value).toBeInstanceOf(UnauthorizedError);
  });

  it('refuses USER and VIEWER membership with UnauthorizedError', () => {
    for (const role of [UserRole.USER, UserRole.VIEWER]) {
      const result = policy.requireRole(makeMembership(role), ALLOWED);

      expect(result.isLeft()).toBe(true);
      if (result.isLeft())
        expect(result.value).toBeInstanceOf(UnauthorizedError);
    }
  });

  it('allows OWNER and ADMIN membership with a null right', () => {
    for (const role of [UserRole.OWNER, UserRole.ADMIN]) {
      const result = policy.requireRole(makeMembership(role), ALLOWED);

      expect(result.isRight()).toBe(true);
      if (result.isRight()) expect(result.value).toBeNull();
    }
  });
});
