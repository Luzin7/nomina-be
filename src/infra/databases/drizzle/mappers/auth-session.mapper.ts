import * as schema from '@infra/databases/drizzle/schema';
import { AuthSession } from '@modules/user/entities/AuthSession';

type AuthSessionDrizzle = typeof schema.authSessions.$inferSelect;
type AuthSessionDrizzleInsert = typeof schema.authSessions.$inferInsert;

export class AuthSessionMapper {
  static toDomain(raw: AuthSessionDrizzle): AuthSession {
    return AuthSession.restore(
      {
        userId: raw.userId,
        userAgent: raw.userAgent,
        createdAt: raw.createdAt,
        lastUsedAt: raw.lastUsedAt,
        expiresAt: raw.expiresAt,
        revokedAt: raw.revokedAt,
      },
      raw.id,
    );
  }

  static toDatabase(entity: AuthSession): AuthSessionDrizzleInsert {
    return {
      id: entity.id,
      userId: entity.userId,
      userAgent: entity.userAgent,
      createdAt: entity.createdAt,
      lastUsedAt: entity.lastUsedAt,
      expiresAt: entity.expiresAt,
      revokedAt: entity.revokedAt,
    };
  }
}
