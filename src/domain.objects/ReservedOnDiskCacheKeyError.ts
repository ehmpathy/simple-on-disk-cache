import { ConstraintError } from 'helpful-errors';

/**
 * thrown when a caller uses the key the cache reserves for its own internal valid-keys index — a
 * public set/get/version of that reserved key would corrupt the valid-keys index (a later keys()
 * could then return garbage or throw on JSON.parse)
 *
 * extends ConstraintError from helpful-errors — a caller-must-fix constraint violation (exit 2)
 * - metadata.key — the reserved key the caller supplied
 */
export class ReservedOnDiskCacheKeyError extends ConstraintError<{
  key: string;
}> {
  constructor({ key }: { key: string }) {
    // lowercase, no end period — matches the terse style of the cache's other caller-visible errors
    super(
      `the on-disk cache key requested is reserved for internal use: '${key}' — choose a different key`,
      { key },
    );
  }
}
