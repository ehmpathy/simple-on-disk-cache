import type { DirectoryToPersistTo } from '../../domain.objects/DirectoryToPersistTo';
import { isRecordExpired } from '../envelope/isRecordExpired';
import { getSourceEntry } from './getSourceEntry';

/**
 * read the version AND value of a key from ONE physical source read, both per logical expiry
 *
 * .what = { found, value } where found is the version (undefined if absent/expired) and value
 *         is the stored value (undefined if absent/expired/tombstone) — both derived from a single
 *         getSourceEntry read.
 * .why = a conditional read must gate on the version AND return the value ATOMICALLY. one physical
 *        read for both removes the check-then-read TOCTOU, where a write between two separate reads
 *        could return a value past the just-checked version.
 */
export const getSourceStateForCondition = async ({
  directory,
  key,
  include,
}: {
  directory: DirectoryToPersistTo;
  key: string;
  /**
   * .what = whether to derive the version; a plain get passes version:false to read the value
   *         via the same pipeline at no version cost (skips the local hash / cloud meta demand)
   */
  include?: { version?: boolean };
}): Promise<{ found: string | undefined; value: string | undefined }> => {
  const entry = await getSourceEntry({ directory, key, include });

  // absent or logically expired → both the version and the value read as absent
  if (entry === null || isRecordExpired({ expiresAtMse: entry.expiresAtMse }))
    return { found: undefined, value: undefined };

  // present + live → the version gates, the value is returned — from the same read
  return { found: entry.version, value: entry.value };
};
