import type { DirectoryToPersistTo } from '../../../domain.objects/DirectoryToPersistTo';
import type { SimpleCacheCondition } from '../../../domain.objects/SimpleCacheCondition';
import { assertConditionMet } from '../../condition/assertConditionMet';
import { getSourceVersion } from '../getSourceVersion';
import { asLocalLockPath } from './lock/asLocalLockPath';
import { withLocalKeyLock } from './lock/withLocalKeyLock';
import { setLocalAtomic } from './setLocalAtomic';

/**
 * write a value to a local-disk file with a version precondition
 *
 * .what = put-if-absent (version: null) or compare-and-set (version: token). both do the same
 *         read-check-write, all under one exclusive per-key lock: read the current source token,
 *         assert the precondition, then overwrite.
 * .why = the whole read-check-write runs under the same `withLocalKeyLock` that every plain
 *        (unconditional) local write also takes — so no writer can slip a change between our
 *        version check and our write (a TOCTOU lost update). there is deliberately NO unlocked
 *        O_EXCL fast path: `fs.link` is atomic only against other link/O_EXCL creates, not against
 *        a concurrent unconditional `fs.writeFile(..., { flag: 'w' })`, so a lock-free put-if-absent
 *        could be silently truncated by a plain set that races it. one lock, one discipline.
 */
export const setToLocalConditional = async ({
  directory,
  localPath,
  key,
  value,
  condition,
}: {
  directory: DirectoryToPersistTo;
  localPath: string;
  key: string;
  value: string;
  condition: SimpleCacheCondition;
}): Promise<void> => {
  const lockPath = asLocalLockPath(localPath);

  // read-check-write under the lock; assertConditionMet covers both put-if-absent (found must be
  // undefined) and compare-and-set (found must equal the token), so one path serves both. the write
  // publishes atomically (temp + rename), so a lock-free reader never sees it torn.
  return withLocalKeyLock({ lockPath }, async () => {
    const found = await getSourceVersion({ directory, key });
    assertConditionMet({ key, condition, found });
    await setLocalAtomic({ path: localPath, value });
  });
};
