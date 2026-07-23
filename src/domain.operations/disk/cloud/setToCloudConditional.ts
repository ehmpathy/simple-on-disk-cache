import type { DirectoryToPersistTo } from '../../../domain.objects/DirectoryToPersistTo';
import type { SimpleCacheCondition } from '../../../domain.objects/SimpleCacheCondition';
import type { SimpleOnDiskCacheCloudAdapter } from '../../../domain.objects/SimpleOnDiskCacheCloudAdapter';
import { isSimpleCacheConditionError } from '../../condition/isSimpleCacheConditionError';
import { isPreconditionFailure } from '../../error/isPreconditionFailure';
import { reconcileCloudPreconditionFailure } from './reconcileCloudPreconditionFailure';
import { setToAdapterConditional } from './setToAdapterConditional';

/**
 * max attempts for the cloud put-if-absent when the target repeatedly races to truly-absent
 * .why = bounds the retry so a pathological race cannot loop or overflow the stack
 */
const CLOUD_RECLAIM_MAX_ATTEMPTS = 3;

/**
 * write a value to a cloud-disk object with a version precondition
 *
 * .what = maps the cache condition onto the cloud etag condition (the etag IS the version
 *         token), and delegates atomicity to the adapter's native conditional write; on a
 *         precondition miss, reconcileCloudPreconditionFailure reclaims an expired target or throws
 * .note = the truly-absent retry (a raced deletion) is bounded by an explicit iterative loop, NOT
 *         recursion — so the frame count stays flat regardless of how many times the target races to
 *         absent, the same flat-frame discipline withLocalKeyLock's acquire loop applies.
 */
export const setToCloudConditional = async ({
  directory,
  adapter,
  uri,
  key,
  value,
  condition,
}: {
  directory: DirectoryToPersistTo;
  adapter: SimpleOnDiskCacheCloudAdapter;
  uri: string;
  key: string;
  value: string;
  condition: SimpleCacheCondition;
}): Promise<void> => {
  for (
    let attemptsLeft = CLOUD_RECLAIM_MAX_ATTEMPTS;
    ;
    attemptsLeft -= 1 // each raced-to-absent retry consumes one attempt
  ) {
    try {
      await setToAdapterConditional({
        adapter,
        uri,
        body: value,
        condition: { etag: condition.version },
      });
      return; // native atomic conditional write succeeded (adapter confirmed via meta.etag)
    } catch (error) {
      // a conformant custom adapter (GCS, Azure, a test double) reports a precondition failure via a
      // thrown SimpleCacheConditionError itself — already the cache's one error contract, so
      // propagate as-is (cross-package-safe via the structural guard); only sdk-aws-s3's own error
      // classes need translation below
      if (isSimpleCacheConditionError(error)) throw error;
      if (!isPreconditionFailure(error)) throw error;

      // classify the precondition failure: reclaim/throw (→ 'done') or a bounded raced-absent retry
      const outcome = await reconcileCloudPreconditionFailure({
        directory,
        adapter,
        uri,
        key,
        value,
        condition,
        attemptsLeft,
      });
      if (outcome === 'done') return;
      // else 'retry' → fall through to the next loop iteration's native conditional write
    }
  }
};
