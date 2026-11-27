export class CacheGenerationBumpError extends Error {
  constructor(
    readonly workspaceId: string,
    readonly counterKey: string,
    readonly operation: string,
    cause?: unknown,
  ) {
    super(
      `cache generation ${counterKey} bump failed for workspace ${workspaceId} during ${operation}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'CacheGenerationBumpError';
  }
}
