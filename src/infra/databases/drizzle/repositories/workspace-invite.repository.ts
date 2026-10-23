import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import * as schema from '@infra/databases/drizzle/schema';
import { WorkspaceInvite } from '@modules/workspace/entities/WorkspaceInvite';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import {
  AcceptInviteOutcome,
  WorkspaceInviteRepository,
} from '@modules/workspace/repositories/contracts/WorkspaceInviteRepository';
import { Injectable } from '@nestjs/common';
import { and, eq, isNull, TransactionRollbackError } from 'drizzle-orm';
import { WorkspaceInviteMapper } from '../mappers/workspace-invite.mapper';

@Injectable()
export class WorkspaceInviteRepositoryImplementation implements WorkspaceInviteRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(invite: WorkspaceInvite): Promise<WorkspaceInvite> {
    const [rawInvite] = await this.drizzle.db
      .insert(schema.workspaceInvites)
      .values(WorkspaceInviteMapper.toDatabase(invite))
      .returning();

    return WorkspaceInviteMapper.toDomain(rawInvite);
  }

  async findByCode(code: string): Promise<WorkspaceInvite | null> {
    const [rawInvite] = await this.drizzle.db
      .select()
      .from(schema.workspaceInvites)
      .where(eq(schema.workspaceInvites.code, code))
      .limit(1);

    if (!rawInvite) return null;
    return WorkspaceInviteMapper.toDomain(rawInvite);
  }

  async accept(
    invite: WorkspaceInvite,
    workspaceUser: WorkspaceUser,
  ): Promise<AcceptInviteOutcome> {
    try {
      return await this.claimAndInsert(invite, workspaceUser);
    } catch (error) {
      if (error instanceof TransactionRollbackError) return 'already_member';
      throw error;
    }
  }

  private claimAndInsert(
    invite: WorkspaceInvite,
    workspaceUser: WorkspaceUser,
  ): Promise<AcceptInviteOutcome> {
    return this.drizzle.db.transaction(async (tx) => {
      const claimed = await tx
        .update(schema.workspaceInvites)
        .set({ usedAt: new Date(), usedBy: workspaceUser.userId })
        .where(
          and(
            eq(schema.workspaceInvites.id, invite.id),
            isNull(schema.workspaceInvites.usedAt),
          ),
        )
        .returning({ id: schema.workspaceInvites.id });

      if (claimed.length === 0) return 'already_used';

      const inserted = await tx
        .insert(schema.workspaceUsers)
        .values({
          id: workspaceUser.id,
          userId: workspaceUser.userId,
          workspaceId: workspaceUser.workspaceId,
          role: workspaceUser.role,
          isDefault: workspaceUser.isDefault,
          joinedAt: workspaceUser.joinedAt,
        })
        .onConflictDoNothing()
        .returning({ id: schema.workspaceUsers.id });

      if (inserted.length > 0) return 'accepted';

      return tx.rollback();
    });
  }
}
