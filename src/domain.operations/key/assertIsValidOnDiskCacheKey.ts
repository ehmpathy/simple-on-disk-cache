import { InvalidOnDiskCacheKeyError } from '../../domain.objects/InvalidOnDiskCacheKeyError';

/**
 * .what = throw InvalidOnDiskCacheKeyError unless the key is safe for on-disk storage — a local
 *         disk file name OR a cloud disk object key (alphanumerics + period, dash, underscore only)
 * .why = the key becomes a file/object path on either tier, so a stray character (slash, null,
 *        `..`) would enable path traversal or an unwritable name; every public entry
 *        (get/set/version) guards with this
 */
export const assertIsValidOnDiskCacheKey = ({ key }: { key: string }): void => {
  const isValid = /^[a-zA-Z0-9.\-_]+$/.test(key); // only allow those characters, to ensure its safe for disk file name
  if (!isValid) throw new InvalidOnDiskCacheKeyError({ key });
};
