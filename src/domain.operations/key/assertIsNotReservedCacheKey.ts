import { RESERVED_CACHE_KEY_FOR_VALID_KEYS } from '../../domain.objects/RESERVED_CACHE_KEY_FOR_VALID_KEYS';
import { ReservedOnDiskCacheKeyError } from '../../domain.objects/ReservedOnDiskCacheKeyError';

/**
 * .what = throw ReservedOnDiskCacheKeyError if a caller uses the key the cache reserves for its own
 *         internal valid-keys index
 * .why = the reserved key is a valid character-wise key, so assertIsValidOnDiskCacheKey lets it
 *        through; a public set/get/version of it would corrupt the valid-keys index. this guard runs
 *        ONLY at the public entry points (set/get/version), never on the internal reads/writes that
 *        legitimately maintain the index — those funnel through the internal set/get directly.
 */
export const assertIsNotReservedCacheKey = ({ key }: { key: string }): void => {
  if (key === RESERVED_CACHE_KEY_FOR_VALID_KEYS)
    throw new ReservedOnDiskCacheKeyError({ key });
};
