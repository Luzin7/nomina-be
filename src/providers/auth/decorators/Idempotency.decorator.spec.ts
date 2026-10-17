import { Reflector } from '@nestjs/core';
import { IDEMPOTENCY_KEY, Idempotent } from './Idempotency.decorator';

class DefaultController {
  @Idempotent()
  handle() {}
}

class ConfiguredController {
  @Idempotent({ ttlSeconds: 120 })
  handle() {}
}

class PlainController {
  handle() {}
}

describe('Idempotent', () => {
  const reflector = new Reflector();

  it('writes metadata under IDEMPOTENCY_KEY when called without options', () => {
    const metadata = reflector.get(
      IDEMPOTENCY_KEY,
      DefaultController.prototype.handle,
    );

    expect(metadata).toBeDefined();
    expect(metadata).toEqual({});
  });

  it('carries ttlSeconds when provided', () => {
    const metadata = reflector.get(
      IDEMPOTENCY_KEY,
      ConfiguredController.prototype.handle,
    );

    expect(metadata).toEqual({ ttlSeconds: 120 });
  });

  it('leaves metadata undefined on a handler without the decorator', () => {
    const metadata = reflector.get(
      IDEMPOTENCY_KEY,
      PlainController.prototype.handle,
    );

    expect(metadata).toBeUndefined();
  });
});
