import type { DirectoryToPersistTo } from '../../domain.objects/DirectoryToPersistTo';
import { RESERVED_CACHE_KEY_FOR_VALID_KEYS } from '../../domain.objects/RESERVED_CACHE_KEY_FOR_VALID_KEYS';
import { asCacheUri } from '../directory/asCacheUri';
import { isCloudDirectory } from '../directory/isCloudDirectory';
import { isLocalDirectory } from '../directory/isLocalDirectory';
import { throwDirectoryUnsupported } from '../directory/throwDirectoryUnsupported';
import { asLocalLockPath } from './local/lock/asLocalLockPath';
import { withLocalKeyLock } from './local/lock/withLocalKeyLock';
import { setLocalAtomic } from './local/setLocalAtomic';

/**
 * write a value to the disk (either the local or cloud variant), unconditionally (last-writer-wins)
 *
 * .what = overwrites the key's stored bytes on whichever tier backs this cache; a real key takes
 *         the per-key lock (local) or the supplier's atomic put (cloud), the reserved valid-keys
 *         key deliberately keeps the pre-feature unlocked atomic write
 * .why = the plain, non-conditional write path — the default every unconditional set() flows
 *        through; conditional writes go via setToDiskConditional instead
 */
export const setToDisk = async ({
  directory,
  key,
  value,
}: {
  directory: DirectoryToPersistTo;
  key: string;
  value: string;
}) => {
  if (isLocalDirectory(directory)) {
    const localPath = asCacheUri({ path: directory.local.path, key });

    // .why = the internal valid_keys record file is NEVER a conditional-write target, and is
    //        already serialized in-process by updateKeyFileBottleneck. a cross-process per-key lock
    //        on it would add a NEW failure mode (a plain, unconditional consumer could see set()
    //        throw the lock-deadline UnexpectedCodePathError under contention on this one shared
    //        key) on a path this feature never needed to touch (a scope leak). so this one key
    //        keeps the pre-feature unlocked atomic write; its cross-process races stay the
    //        documented best-effort "safe drop", unchanged by this feature.
    if (key === RESERVED_CACHE_KEY_FOR_VALID_KEYS)
      return await setLocalAtomic({ path: localPath, value });

    // .why = every REAL-key local write runs under the same per-key lock as a conditional write,
    //        so a plain unconditional set cannot land between a compare-and-set's version read and
    //        its overwrite (which would be a silent lost update the cloud disk's native
    //        conditional put already precludes). local-disk atomicity is an app-level lock convention,
    //        so every writer to a real key — conditional or not — must honor the one lock. the
    //        write itself publishes atomically (temp + rename), so a lock-free reader never sees
    //        it torn.
    return await withLocalKeyLock(
      { lockPath: asLocalLockPath(localPath) },
      () => setLocalAtomic({ path: localPath, value }),
    );
  }
  if (isCloudDirectory(directory)) {
    return await directory.cloud.via.set({
      uri: asCacheUri({ path: directory.cloud.path, key }),
      body: value,
    });
  }
  return throwDirectoryUnsupported(directory);
};
