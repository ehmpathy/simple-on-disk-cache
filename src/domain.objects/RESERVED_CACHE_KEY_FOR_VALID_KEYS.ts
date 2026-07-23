/**
 * the reserved key under which the cache records its set of valid keys
 *
 * .why = kept in its own module so both the public factory (createCache.ts) and the disk-write path
 *        (disk/setToDisk) can import it without a cycle
 */
export const RESERVED_CACHE_KEY_FOR_VALID_KEYS =
  '_.simple_on_disk_cache.valid_keys';
