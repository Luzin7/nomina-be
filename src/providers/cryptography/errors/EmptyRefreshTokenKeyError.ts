export class EmptyRefreshTokenKeyError extends Error {
  constructor() {
    super('The refresh token key material must not be empty.');
    this.name = 'EmptyRefreshTokenKeyError';
  }
}
