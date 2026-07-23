import type { DirectoryToPersistTo } from '../../domain.objects/DirectoryToPersistTo';
import { getSourceStateForCondition } from './getSourceStateForCondition';

/**
 * read the current opaque version for a key (undefined if logically absent)
 *
 * .what = physical version when present + not expired; undefined when absent or expired
 * .why = honors logical expiry — an expired entry reads as absent (so put-if-absent reclaims it).
 *        delegates the absent/expired check to getSourceStateForCondition (one shared rule, no
 *        hand-maintained copy) and keeps only the version half of its { found, value } result
 */
export const getSourceVersion = async ({
  directory,
  key,
}: {
  directory: DirectoryToPersistTo;
  key: string;
}): Promise<string | undefined> => {
  const { found } = await getSourceStateForCondition({ directory, key });
  return found;
};
