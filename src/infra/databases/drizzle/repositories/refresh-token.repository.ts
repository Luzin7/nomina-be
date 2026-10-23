import { RefreshTokenStatus } from '@constants/enums';
import { DrizzleService } from '@infra/databases/drizzle/drizzle.service';
import { RefreshToken } from '@modules/user/entities/RefreshToken';
import { RefreshTokensRepository } from '@modules/user/repositories/contracts/refresh-token.repository';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { RefreshTokenMapper } from '../mappers/refresh-token.mapper';
import * as schema from '../schema';

@Injectable()
export class RefreshTokenRepositoryImplementation implements RefreshTokensRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(refreshToken: RefreshToken): Promise<void> {
    await this.drizzle.db
      .insert(schema.refreshTokens)
      .values(RefreshTokenMapper.toDatabase(refreshToken));
  }

  async findUniqueByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    const [token] = await this.drizzle.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!token) return null;

    return RefreshTokenMapper.toDomain(token);
  }

  async rotate(current: RefreshToken, next: RefreshToken): Promise<boolean> {
    return this.drizzle.db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.refreshTokens)
        .set({
          status: RefreshTokenStatus.ROTATED,
          rotatedAt: current.rotatedAt,
        })
        .where(
          and(
            eq(schema.refreshTokens.id, current.id),
            eq(schema.refreshTokens.status, RefreshTokenStatus.ACTIVE),
          ),
        )
        .returning({ id: schema.refreshTokens.id });

      if (updated.length === 0) return false;

      await tx
        .insert(schema.refreshTokens)
        .values(RefreshTokenMapper.toDatabase(next));

      return true;
    });
  }

  async revokeBySessionId(sessionId: string): Promise<void> {
    await this.drizzle.db
      .update(schema.refreshTokens)
      .set({ status: RefreshTokenStatus.REVOKED })
      .where(eq(schema.refreshTokens.sessionId, sessionId));
  }

  async delete(id: string): Promise<void> {
    await this.drizzle.db
      .delete(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, id));
  }
}
