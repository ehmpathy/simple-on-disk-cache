import { ConstraintError } from 'helpful-errors';

/**
 * thrown when a cache key contains characters that are unsafe for use on the disk — a local
 * disk file name or a cloud disk object key (the key is validated identically for both tiers)
 *
 * extends ConstraintError from helpful-errors — a caller-must-fix constraint violation (exit 2)
 * - metadata.key — the invalid key the caller supplied
 */
export class InvalidOnDiskCacheKeyError extends ConstraintError<{
  key: string;
}> {
  constructor({ key }: { key: string }) {
    // lowercase, no end period — matches the terse style of the cache's other caller-visible
    // errors (e.g. SimpleCacheConditionError's "cache condition failed: version mismatch"), so the
    // whole cache error family reads with one consistent tone in a snapshot diff and in logs
    super(
      `the on-disk cache key requested is invalid: '${key}' — only alphanumeric characters and period, dash, and underscore are allowed`,
      { key },
    );
  }
}
