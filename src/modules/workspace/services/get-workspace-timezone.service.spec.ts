import { DEFAULT_TIMEZONE } from '@constants/timezone';
import { CacheProvider } from '@infra/cache/contracts/CacheProvider';
import { WorkspaceRepository } from '../repositories/contracts/WorkspaceRepository';
import {
  GetWorkspaceTimezoneService,
  WORKSPACE_TIMEZONE_CACHE_TTL_SECONDS,
} from './get-workspace-timezone.service';

describe('GetWorkspaceTimezoneService', () => {
  let service: GetWorkspaceTimezoneService;
  let workspaceRepository: jest.Mocked<WorkspaceRepository>;
  let cache: jest.Mocked<CacheProvider>;

  beforeEach(() => {
    workspaceRepository = {
      findTimezoneById: jest.fn().mockResolvedValue('America/Recife'),
    } as unknown as jest.Mocked<WorkspaceRepository>;
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CacheProvider>;

    service = new GetWorkspaceTimezoneService(workspaceRepository, cache);
  });

  it('uses a thirty day cache TTL', () => {
    expect(WORKSPACE_TIMEZONE_CACHE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it('reads the cache and skips the repository when the memo is cold', async () => {
    cache.get.mockResolvedValue('America/Manaus');

    const timezone = await service.execute('ws-1');

    expect(timezone).toBe('America/Manaus');
    expect(cache.get).toHaveBeenCalledWith('workspace:timezone:ws-1');
    expect(workspaceRepository.findTimezoneById).not.toHaveBeenCalled();
  });

  it('queries the repository once and fills the cache on a full miss', async () => {
    const timezone = await service.execute('ws-1');

    expect(timezone).toBe('America/Recife');
    expect(workspaceRepository.findTimezoneById).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'workspace:timezone:ws-1',
      'America/Recife',
      WORKSPACE_TIMEZONE_CACHE_TTL_SECONDS,
    );
  });

  it('serves repeated calls from the memo without cache or repository', async () => {
    await service.execute('ws-1');
    await service.execute('ws-1');

    expect(cache.get).toHaveBeenCalledTimes(1);
    expect(workspaceRepository.findTimezoneById).toHaveBeenCalledTimes(1);
  });

  it('keeps one entry per workspace', async () => {
    await service.execute('ws-1');
    await service.execute('ws-2');

    expect(workspaceRepository.findTimezoneById).toHaveBeenCalledTimes(2);
  });

  it('falls back to the repository when the cache is unavailable', async () => {
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(false);

    const timezone = await service.execute('ws-1');

    expect(timezone).toBe('America/Recife');
    expect(workspaceRepository.findTimezoneById).toHaveBeenCalledTimes(1);
  });

  it('returns the default timezone without persisting it when the workspace has none', async () => {
    workspaceRepository.findTimezoneById.mockResolvedValue(null);

    const timezone = await service.execute('ws-1');

    expect(timezone).toBe(DEFAULT_TIMEZONE);
    expect(cache.set).not.toHaveBeenCalled();
    await service.execute('ws-1');
    expect(workspaceRepository.findTimezoneById).toHaveBeenCalledTimes(2);
  });
});
