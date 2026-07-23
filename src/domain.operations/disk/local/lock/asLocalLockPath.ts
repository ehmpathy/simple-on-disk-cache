/**
 * lock-path for a local-disk key — a sibling of the key file that cannot collide with any valid key
 *
 * .why = valid cache keys match /^[a-zA-Z0-9.\-_]+$/ (see assertIsValidOnDiskCacheKey); the `#`
 *        makes this path un-representable as a key, so a lock never shadows a real cache file
 */
export const asLocalLockPath = (localPath: string): string =>
  `${localPath}#lock`;
