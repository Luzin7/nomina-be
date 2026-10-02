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

  async findUniqueByUserIdAndToken(
    userId: string,
    token: string,
  ): Promise<RefreshToken | null> {
    const refreshTokens = await this.drizzle.db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          eq(schema.refreshTokens.token, token),
        ),
      );

    return refreshTokens.length
      ? RefreshTokenMapper.toDomain(refreshTokens[0])
      : null;
  }

  async replaceByToken(
    userId: string,
    currentToken: string,
    nextRefreshToken: RefreshToken,
  ): Promise<boolean> {
    return this.drizzle.db.transaction(async (tx) => {
      const removed = await tx
        .delete(schema.refreshTokens)
        .where(
          and(
            eq(schema.refreshTokens.userId, userId),
            eq(schema.refreshTokens.token, currentToken),
          ),
        )
        .returning({ id: schema.refreshTokens.id });

      if (removed.length === 0) return false;

      await tx.insert(schema.refreshTokens).values({
        userId,
        token: nextRefreshToken.token,
        expiresIn: nextRefreshToken.expiresIn,
      });

      return true;
    });
  }

  async replaceAllByUserId(
    userId: string,
    nextRefreshToken: RefreshToken,
  ): Promise<void> {
    await this.drizzle.db.transaction(async (tx) => {
      await tx
        .delete(schema.refreshTokens)
        .where(eq(schema.refreshTokens.userId, userId));

      await tx.insert(schema.refreshTokens).values({
        userId,
        token: nextRefreshToken.token,
        expiresIn: nextRefreshToken.expiresIn,
      });
    });
  }

  async delete(id: string): Promise<void> {
    await this.drizzle.db
      .delete(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, id));
  }
}
