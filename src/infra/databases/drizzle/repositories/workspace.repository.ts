import { AccountType, UserRole } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { Workspace } from '@modules/workspace/entities/Workspace';
import { WorkspaceUser } from '@modules/workspace/entities/WorkspaceUser';
import { WorkspaceRepository } from '@modules/workspace/repositories/contracts/WorkspaceRepository';
import { Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { WorkspaceMapper } from '../mappers/workspace.mapper';
import * as schema from '../schema';

@Injectable()
export class WorkspaceRepositoryImplementation implements WorkspaceRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(workspace: Workspace): Promise<Workspace> {
    const [createdWorkspace] = await this.drizzle.db
      .insert(schema.workspaces)
      .values({
        id: workspace.id,
        name: workspace.name,
        currency: workspace.currency,
        timezone: workspace.timezone,
      })
      .returning();

    return WorkspaceMapper.toDomain(createdWorkspace);
  }

  async createWithOwnerAndAccount(
    workspace: Workspace,
    owner: WorkspaceUser,
  ): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      if (owner.isDefault) {
        await tx
          .update(schema.workspaceUsers)
          .set({ isDefault: false })
          .where(
            and(
              eq(schema.workspaceUsers.userId, owner.userId),
              eq(schema.workspaceUsers.isDefault, true),
            ),
          );
      }

      await tx.insert(schema.workspaces).values({
        id: workspace.id,
        name: workspace.name,
        currency: workspace.currency,
        timezone: workspace.timezone,
      });

      await tx.insert(schema.workspaceUsers).values({
        id: owner.id,
        userId: owner.userId,
        workspaceId: workspace.id,
        role: owner.role,
        isDefault: owner.isDefault,
        joinedAt: owner.joinedAt,
      });

      await tx.insert(schema.accounts).values({
        workspaceId: workspace.id,
        name: 'Carteira',
        type: AccountType.CASH,
        balance: 0,
        timezone: workspace.timezone,
      });
    });
  }

  async update(workspace: Workspace): Promise<Workspace> {
    const [updatedWorkspace] = await this.drizzle.db
      .update(schema.workspaces)
      .set({
        name: workspace.name,
        currency: workspace.currency,
        timezone: workspace.timezone,
      })
      .where(eq(schema.workspaces.id, workspace.id))
      .returning();

    return WorkspaceMapper.toDomain(updatedWorkspace);
  }

  async delete(id: string): Promise<void> {
    await this.drizzle.db
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, id));
  }

  async findById(id: string): Promise<Workspace | null> {
    const [workspace] = await this.drizzle.db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);

    return workspace ? WorkspaceMapper.toDomain(workspace) : null;
  }

  async findTimezoneById(id: string): Promise<string | null> {
    const [workspace] = await this.drizzle.db
      .select({ timezone: schema.workspaces.timezone })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);

    return workspace?.timezone ?? null;
  }

  async findOwnedByUserId(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    workspaces: Array<{
      workspace: Workspace;
      role: UserRole;
      isDefault: boolean;
    }>;
    total: number;
  }> {
    const skip = (page - 1) * limit;

    const [workspaceUsersQuery, [{ totalCount }]] = await Promise.all([
      this.drizzle.db
        .select({
          workspaceUser: schema.workspaceUsers,
          workspace: schema.workspaces,
        })
        .from(schema.workspaceUsers)
        .innerJoin(
          schema.workspaces,
          eq(schema.workspaceUsers.workspaceId, schema.workspaces.id),
        )
        .where(
          and(
            eq(schema.workspaceUsers.userId, userId),
            eq(schema.workspaceUsers.role, UserRole.OWNER),
          ),
        )
        .limit(limit)
        .offset(skip),

      this.drizzle.db
        .select({ totalCount: count() })
        .from(schema.workspaceUsers)
        .where(
          and(
            eq(schema.workspaceUsers.userId, userId),
            eq(schema.workspaceUsers.role, UserRole.OWNER),
          ),
        ),
    ]);

    return {
      workspaces: workspaceUsersQuery.map((row) => ({
        workspace: WorkspaceMapper.toDomain(row.workspace),
        role: row.workspaceUser.role as UserRole,
        isDefault: row.workspaceUser.isDefault,
      })),
      total: totalCount,
    };
  }

  async countOwnedByUserId(userId: string): Promise<number> {
    const [{ totalCount }] = await this.drizzle.db
      .select({ totalCount: count() })
      .from(schema.workspaceUsers)
      .where(
        and(
          eq(schema.workspaceUsers.userId, userId),
          eq(schema.workspaceUsers.role, UserRole.OWNER),
        ),
      );

    return totalCount;
  }
}
