import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { AuthSession } from '@modules/user/entities/AuthSession';
import { AuthSessionsRepository } from '@modules/user/repositories/contracts/auth-session.repository';
import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuthSessionMapper } from '../mappers/auth-session.mapper';
import * as schema from '../schema';

@Injectable()
export class AuthSessionRepositoryImplementation implements AuthSessionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(authSession: AuthSession): Promise<AuthSession> {
    const [createdSession] = await this.drizzle.db
      .insert(schema.authSessions)
      .values(AuthSessionMapper.toDatabase(authSession))
      .returning();

    return AuthSessionMapper.toDomain(createdSession);
  }

  async renew(authSession: AuthSession): Promise<void> {
    await this.drizzle.db
      .update(schema.authSessions)
      .set({
        expiresAt: authSession.expiresAt,
        lastUsedAt: authSession.lastUsedAt,
      })
      .where(
        and(
          eq(schema.authSessions.id, authSession.id),
          isNull(schema.authSessions.revokedAt),
        ),
      );
  }

  async findUniqueById(id: string): Promise<AuthSession | null> {
    const [session] = await this.drizzle.db
      .select()
      .from(schema.authSessions)
      .where(eq(schema.authSessions.id, id))
      .limit(1);

    if (!session) return null;

    return AuthSessionMapper.toDomain(session);
  }

  async revoke(id: string): Promise<void> {
    await this.drizzle.db
      .update(schema.authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.authSessions.id, id),
          isNull(schema.authSessions.revokedAt),
        ),
      );
  }

  async delete(id: string): Promise<void> {
    await this.drizzle.db
      .delete(schema.authSessions)
      .where(eq(schema.authSessions.id, id));
  }
}
