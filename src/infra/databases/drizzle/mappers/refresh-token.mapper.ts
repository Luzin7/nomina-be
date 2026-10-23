import { RefreshTokenStatus } from '@constants/enums';
import * as schema from '@infra/databases/drizzle/schema';
import { RefreshToken } from '@modules/user/entities/RefreshToken';

type RefreshTokenDrizzle = typeof schema.refreshTokens.$inferSelect;
type RefreshTokenDrizzleInsert = typeof schema.refreshTokens.$inferInsert;

export class RefreshTokenMapper {
  static toDomain(raw: RefreshTokenDrizzle): RefreshToken {
    return RefreshToken.restore(
      {
        sessionId: raw.sessionId,
        tokenHash: raw.tokenHash,
        status: raw.status as RefreshTokenStatus,
        expiresAt: raw.expiresAt,
        createdAt: raw.createdAt,
        rotatedAt: raw.rotatedAt,
      },
      raw.id,
    );
  }

  static toDatabase(entity: RefreshToken): RefreshTokenDrizzleInsert {
    return {
      id: entity.id,
      sessionId: entity.sessionId,
      tokenHash: entity.tokenHash,
      status: entity.status,
      expiresAt: entity.expiresAt,
      createdAt: entity.createdAt,
      rotatedAt: entity.rotatedAt,
    };
  }
}
