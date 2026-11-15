export class UnregisteredCacheClassError extends Error {
  constructor(className: string) {
    super(`class ${className} is not registered in the cache codec`);
    this.name = 'UnregisteredCacheClassError';
  }
}

export class UndecodableCacheEntryError extends Error {
  constructor(reason: string) {
    super(`cache entry cannot be decoded: ${reason}`);
    this.name = 'UndecodableCacheEntryError';
  }
}
