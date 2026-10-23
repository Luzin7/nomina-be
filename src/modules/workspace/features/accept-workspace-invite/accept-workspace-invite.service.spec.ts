import { UserRole } from '@constants/enums';
import { WorkspaceInvite } from '@modules/workspace/entities/WorkspaceInvite';
import {
  ConflictWorkspaceUserError,
  InviteAlreadyUsedError,
  InviteExpiredError,
  InviteNotFoundError,
} from '@modules/workspace/errors';
import { WorkspaceInviteRepository } from '@modules/workspace/repositories/contracts/WorkspaceInviteRepository';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { AcceptWorkspaceInviteService } from './accept-workspace-invite.service';

const CODE = 'ABCD1234';

function makeInvite(
  overrides: Partial<{ expiresAt: Date; usedAt: Date | null }> = {},
): WorkspaceInvite {
  const result = WorkspaceInvite.create(
    {
      code: CODE,
      workspaceId: 'ws-1',
      role: UserRole.USER,
      createdBy: 'owner-1',
      expiresAt: new Date(Date.now() + 86_400_000),
      ...overrides,
    },
    'invite-1',
  );
  if (result.isLeft()) throw result.value;
  return result.value;
}

describe('AcceptWorkspaceInviteService', () => {
  let service: AcceptWorkspaceInviteService;
  let inviteRepository: jest.Mocked<WorkspaceInviteRepository>;
  let workspaceUserRepository: jest.Mocked<WorkspaceUserRepository>;

  beforeEach(() => {
    inviteRepository = {
      create: jest.fn(),
      findByCode: jest.fn(),
      accept: jest.fn(),
    } as jest.Mocked<WorkspaceInviteRepository>;
    workspaceUserRepository = {
      findUserByWorkspaceAndUserId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<WorkspaceUserRepository>;
    service = new AcceptWorkspaceInviteService(
      inviteRepository,
      workspaceUserRepository,
    );
  });

  it('should accept a lowercase code with surrounding spaces', async () => {
    inviteRepository.findByCode.mockResolvedValue(makeInvite());
    inviteRepository.accept.mockResolvedValue('accepted');

    const result = await service.execute({
      code: `  ${CODE.toLowerCase()} `,
      sub: 'user-2',
    });

    expect(inviteRepository.findByCode).toHaveBeenCalledWith(CODE);
    expect(result.isRight()).toBe(true);
  });

  it('should return InviteNotFoundError when the code does not exist', async () => {
    inviteRepository.findByCode.mockResolvedValue(null);

    const result = await service.execute({ code: CODE, sub: 'user-2' });

    expect(result.value).toBeInstanceOf(InviteNotFoundError);
  });

  it('should return InviteExpiredError when the invite expired', async () => {
    inviteRepository.findByCode.mockResolvedValue(
      makeInvite({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    const result = await service.execute({ code: CODE, sub: 'user-2' });

    expect(result.value).toBeInstanceOf(InviteExpiredError);
  });

  it('should return InviteAlreadyUsedError when the invite was used', async () => {
    inviteRepository.findByCode.mockResolvedValue(
      makeInvite({ usedAt: new Date() }),
    );

    const result = await service.execute({ code: CODE, sub: 'user-2' });

    expect(result.value).toBeInstanceOf(InviteAlreadyUsedError);
  });

  it('should return InviteAlreadyUsedError when the claim is lost', async () => {
    inviteRepository.findByCode.mockResolvedValue(makeInvite());
    inviteRepository.accept.mockResolvedValue('already_used');

    const result = await service.execute({ code: CODE, sub: 'user-2' });

    expect(result.value).toBeInstanceOf(InviteAlreadyUsedError);
  });

  it('should return ConflictWorkspaceUserError when already a member', async () => {
    inviteRepository.findByCode.mockResolvedValue(makeInvite());
    workspaceUserRepository.findUserByWorkspaceAndUserId.mockResolvedValue(
      {} as never,
    );

    const result = await service.execute({ code: CODE, sub: 'user-2' });

    expect(result.value).toBeInstanceOf(ConflictWorkspaceUserError);
    expect(inviteRepository.accept).not.toHaveBeenCalled();
  });
});
