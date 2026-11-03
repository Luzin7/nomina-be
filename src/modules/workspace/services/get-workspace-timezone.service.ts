import { DEFAULT_TIMEZONE } from '@constants/timezone';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { Injectable } from '@nestjs/common';
import { WorkspaceRepository } from '../repositories/contracts/WorkspaceRepository';

export const WORKSPACE_TIMEZONE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

const workspaceTimezoneCacheKey = (workspaceId: string): string =>
  `workspace:timezone:${workspaceId}`;

@Injectable()
export class GetWorkspaceTimezoneService {
  private readonly memo = new Map<string, string>();

  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly cache: CacheProvider,
  ) {}

  async execute(workspaceId: string): Promise<string> {
    const memoized = this.memo.get(workspaceId);
    if (memoized) return memoized;

    const key = workspaceTimezoneCacheKey(workspaceId);
    const cached = await this.cache.get(key);
    if (cached) {
      this.memo.set(workspaceId, cached);
      return cached;
    }

    const stored = await this.workspaceRepository.findTimezoneById(workspaceId);
    if (!stored) return DEFAULT_TIMEZONE;

    this.memo.set(workspaceId, stored);
    await this.cache.set(key, stored, WORKSPACE_TIMEZONE_CACHE_TTL_SECONDS);

    return stored;
  }
}
