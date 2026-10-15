import { AccountType, UserRole } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { buildDefaultCategories } from '@modules/category/constants/default-categories';
import { PlanType } from '@modules/subscription';
import { User } from '@modules/user/entities/User';
import { UserRepository } from '@modules/user/repositories/contracts/user.repository';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CategoryMapper } from '../mappers/category.mapper';
import { UserMapper } from '../mappers/user.mapper';
import * as schema from '../schema';

@Injectable()
export class UserRepositoryImplementation implements UserRepository {
  constructor(private readonly drizzle: DrizzleService) {}
  async findUniqueByEmail(email: string): Promise<User | null> {
    const user = await this.drizzle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));

    if (!user[0]) {
      return null;
    }

    return UserMapper.toDomain(user[0]);
  }

  async create(user: User): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      await tx.insert(schema.users).values(UserMapper.toDatabase(user));

      const workspaceId = crypto.randomUUID();
      await tx.insert(schema.workspaces).values({
        id: workspaceId,
        name: 'Espaço Pessoal',
      });

      await tx.insert(schema.subscriptions).values({
        id: crypto.randomUUID(),
        userId: user.id,
        planId: PlanType.TRIAL,
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await tx.insert(schema.workspaceUsers).values({
        id: crypto.randomUUID(),
        userId: user.id,
        workspaceId,
        role: UserRole.OWNER,
        isDefault: true,
        joinedAt: new Date(),
      });

      await tx.insert(schema.accounts).values({
        id: crypto.randomUUID(),
        workspaceId,
        name: 'Carteira',
        type: AccountType.CASH,
        balance: 0,
      });

      await tx
        .insert(schema.categories)
        .values(
          buildDefaultCategories(workspaceId).map((category) =>
            CategoryMapper.toDatabase(category),
          ),
        );
    });
  }

  async update(user: User): Promise<void> {
    await this.drizzle.db
      .update(schema.users)
      .set(UserMapper.toDatabase(user))
      .where(eq(schema.users.id, user.id));
  }

  async delete(id: string): Promise<void> {
    await this.drizzle.db.delete(schema.users).where(eq(schema.users.id, id));
  }

  async findUniqueById(id: string): Promise<User | null> {
    const user = await this.drizzle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));

    if (!user[0]) {
      return null;
    }

    return UserMapper.toDomain(user[0]);
  }
}
