import {
  UndecodableCacheEntryError,
  UnregisteredCacheClassError,
} from './errors/cache-codec.errors';

export interface CacheCodec<T> {
  encode(value: T): string;
  decode(raw: string): T;
}

export interface CacheableClass {
  readonly name: string;
  readonly prototype: object;
}

interface TaggedDate {
  $date: number;
}

interface TaggedBigInt {
  $bigint: string;
}

interface TaggedInstance {
  $class: string;
  $fields: Record<string, unknown>;
}

const isPlainContainer = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === null || prototype === Object.prototype || Array.isArray(value)
  );
};

const isTaggedDate = (value: unknown): value is TaggedDate =>
  typeof value === 'object' &&
  value !== null &&
  Object.keys(value).length === 1 &&
  typeof (value as TaggedDate).$date === 'number';

const isTaggedBigInt = (value: unknown): value is TaggedBigInt =>
  typeof value === 'object' &&
  value !== null &&
  Object.keys(value).length === 1 &&
  typeof (value as TaggedBigInt).$bigint === 'string';

const isTaggedInstance = (value: unknown): value is TaggedInstance =>
  typeof value === 'object' &&
  value !== null &&
  Object.keys(value).length === 2 &&
  typeof (value as TaggedInstance).$class === 'string' &&
  typeof (value as TaggedInstance).$fields === 'object';

export function createStructuredCodec<T>(
  classes: CacheableClass[] = [],
): CacheCodec<T> {
  const registry = new Map(classes.map((entry) => [entry.name, entry]));

  function encodeValue(this: unknown, key: string, value: unknown): unknown {
    const original = (this as Record<string, unknown>)[key];

    if (original instanceof Date) return { $date: original.getTime() };
    if (typeof value === 'bigint') return { $bigint: value.toString() };
    if (typeof value !== 'object' || value === null) return value;
    if (isPlainContainer(value)) return value;

    const className = value.constructor.name;
    const registered = registry.get(className);
    if (!registered || registered.prototype !== Object.getPrototypeOf(value)) {
      throw new UnregisteredCacheClassError(className);
    }

    return { $class: className, $fields: { ...value } };
  }

  function decodeValue(_key: string, value: unknown): unknown {
    if (isTaggedDate(value)) return new Date(value.$date);
    if (isTaggedBigInt(value)) return BigInt(value.$bigint);
    if (!isTaggedInstance(value)) return value;

    const registered = registry.get(value.$class);
    if (!registered) {
      throw new UndecodableCacheEntryError(`unknown class ${value.$class}`);
    }

    return Object.assign(Object.create(registered.prototype), value.$fields);
  }

  return {
    encode: (value) => JSON.stringify(value, encodeValue),
    decode: (raw) => JSON.parse(raw, decodeValue) as T,
  };
}
