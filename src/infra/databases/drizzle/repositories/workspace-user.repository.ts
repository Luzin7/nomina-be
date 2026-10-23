import { UserRole } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceUserRepository } from '@modules/workspace/repositories/contracts/WorkspaceUserRepository';
import { Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { WorkspaceUserMapper } from '../mappers/workspace-user.mapper';
import * as schema from '../schema';
import { ensureEntityId } from './ensure-entity-id';

@Injectable()
export class WorkspaceUserRepositoryImplementation implements WorkspaceUserRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async setDefaultWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      await tx
        .update(schema.workspaceUsers)
        .set({ isDefault: false })
        .where(
          and(
            eq(schema.workspaceUsers.userId, userId),
            eq(schema.workspaceUsers.isDefault, true),
          ),
        );

      await tx
        .update(schema.workspaceUsers)
        .set({ isDefault: true })
        .where(
          and(
            eq(schema.workspaceUsers.userId, userId),
            eq(schema.workspaceUsers.workspaceId, workspaceId),
          ),
        );
    });
  }

  async findOwnerByWorkspaceId(
    workspaceId: string,
  ): Promise<WorkspaceUser | null> {
    const [workspaceUser] = await this.drizzle.db
      .select()
      .from(schema.workspaceUsers)
      .where(
        and(
          eq(schema.workspaceUsers.workspaceId, workspaceId),
          eq(schema.workspaceUsers.role, UserRole.OWNER),
        ),
      )
      .limit(1);

    if (!workspaceUser) return null;

    return WorkspaceUserMapper.toDomain(workspaceUser);
  }

  async countByWorkspaceId(workspaceId: string): Promise<number> {
    const [{ totalCount }] = await this.drizzle.db
      .select({ totalCount: count() })
      .from(schema.workspaceUsers)
      .where(eq(schema.workspaceUsers.workspaceId, workspaceId));

    return totalCount;
  }

  async findDefaultWorkspaceByUserId(
    userId: string,
  ): Promise<{ user: WorkspaceUser; workspaceName: string } | null> {
    const [result] = await this.drizzle.db
      .select({
        rawUser: schema.workspaceUsers,
        workspaceName: schema.workspaces.name,
      })
      .from(schema.workspaceUsers)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaces.id, schema.workspaceUsers.workspaceId),
      )
      .where(
        and(
          eq(schema.workspaceUsers.userId, userId),
          eq(schema.workspaceUsers.isDefault, true),
        ),
      )
      .limit(1);

    if (!result) return null;

    return {
      user: WorkspaceUserMapper.toDomain(result.rawUser),
      workspaceName: result.workspaceName,
    };
  }

  async addUserToWorkspace(
    workspaceUser: WorkspaceUser,
  ): Promise<WorkspaceUser> {
    const [createdWorkspaceUser] = await this.drizzle.db
      .insert(schema.workspaceUsers)
      .values({
        id: ensureEntityId(workspaceUser),
        userId: workspaceUser.userId,
        workspaceId: workspaceUser.workspaceId,
        role: workspaceUser.role,
        isDefault: workspaceUser.isDefault,
        joinedAt: workspaceUser.joinedAt,
      })
      .returning();

    return WorkspaceUserMapper.toDomain(createdWorkspaceUser);
  }

  async removeUserFromWorkspace(id: string): Promise<void> {
    await this.drizzle.db
      .delete(schema.workspaceUsers)
      .where(eq(schema.workspaceUsers.id, id));
  }

  async updateUser(workspaceUser: WorkspaceUser): Promise<WorkspaceUser> {
    const [updatedWorkspaceUser] = await this.drizzle.db
      .update(schema.workspaceUsers)
      .set({
        role: workspaceUser.role,
        isDefault: workspaceUser.isDefault,
      })
      .where(eq(schema.workspaceUsers.id, workspaceUser.id))
      .returning();

    return WorkspaceUserMapper.toDomain(updatedWorkspaceUser);
  }

  async findMembershipById(id: string): Promise<WorkspaceUser | null> {
    const [workspaceUser] = await this.drizzle.db
      .select()
      .from(schema.workspaceUsers)
      .where(eq(schema.workspaceUsers.id, id))
      .limit(1);

    if (!workspaceUser) return null;

    return WorkspaceUserMapper.toDomain(workspaceUser);
  }

  async findUsersByWorkspaceId(
    workspaceId: string,
    page: number,
    limit: number,
  ): Promise<{ workspaceUsers: WorkspaceUser[]; total: number }> {
    const offset = (page - 1) * limit;

    const [users, [{ totalCount }]] = await Promise.all([
      this.drizzle.db
        .select()
        .from(schema.workspaceUsers)
        .where(eq(schema.workspaceUsers.workspaceId, workspaceId))
        .limit(limit)
        .offset(offset),

      this.drizzle.db
        .select({ totalCount: count() })
        .from(schema.workspaceUsers)
        .where(eq(schema.workspaceUsers.workspaceId, workspaceId)),
    ]);

    return {
      workspaceUsers: users.map(WorkspaceUserMapper.toDomain),
      total: totalCount,
    };
  }

  async findUserByWorkspaceAndUserId(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceUser | null> {
    const [workspaceUser] = await this.drizzle.db
      .select()
      .from(schema.workspaceUsers)
      .where(
        and(
          eq(schema.workspaceUsers.workspaceId, workspaceId),
          eq(schema.workspaceUsers.userId, userId),
        ),
      )
      .limit(1);

    if (!workspaceUser) return null;

    return WorkspaceUserMapper.toDomain(workspaceUser);
  }
}
