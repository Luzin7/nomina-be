import { Entity } from '@shared/core/Entities/Entity';
import { randomUUID } from 'node:crypto';

export function ensureEntityId(entity: Entity<unknown>): string {
  if (!entity.id) entity.setId(randomUUID());

  return entity.id;
}
