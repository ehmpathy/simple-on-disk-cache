import type { DirectoryToPersistTo } from '../../../domain.objects/DirectoryToPersistTo';
import type { SimpleCacheCondition } from '../../../domain.objects/SimpleCacheCondition';
import type { SimpleOnDiskCacheCloudAdapter } from '../../../domain.objects/SimpleOnDiskCacheCloudAdapter';
import { isSimpleCacheConditionError } from '../../condition/isSimpleCacheConditionError';
import { throwConditionAbsent } from '../../condition/throwConditionAbsent';
import { isPreconditionFailure } from '../../error/isPreconditionFailure';
import { getSourceVersion } from '../getSourceVersion';
import { setToAdapterConditional } from './setToAdapterConditional';

/**
 * atomically reclaim an expired cloud-disk object via compare-and-set on its current etag
 *
 * .what = writes the value under a compare-and-set on the expired object's current etag; on a
 *         precondition miss (another racer reclaimed first) it surfaces the loss as a
 *         put-if-absent conflict via the shared canonical message
 * .why = put-if-absent treats an expired object as logically absent; a CAS on its current etag
 *        lets exactly one concurrent racer win the reclaim — the rest hit a precondition miss
 *        and surface as a put-if-absent conflict
 */
export const setToCloudExpired = async ({
  directory,
  adapter,
  uri,
  key,
  value,
  condition,
  currentEtag,
}: {
  directory: DirectoryToPersistTo;
  adapter: SimpleOnDiskCacheCloudAdapter;
  uri: string;
  key: string;
  value: string;
  condition: SimpleCacheCondition;
  currentEtag: string;
}): Promise<void> => {
  try {
    await setToAdapterConditional({
      adapter,
      uri,
      body: value,
      condition: { etag: currentEtag },
    });
  } catch (error) {
    // a conformant custom adapter reports the conflict via SimpleCacheConditionError — propagate
    if (isSimpleCacheConditionError(error)) throw error;
    if (!isPreconditionFailure(error)) throw error;

    // another racer reclaimed first — we lost the race. this uses throwConditionAbsent for the
    // shared canonical message, but does NOT route through assertConditionMet: this is an
    // unconditional lost-race signal (our CAS-on-etag failed), and it must fail loud even if the
    // key has since raced to truly-absent — the gate would silently NOT throw on an absent `found`,
    // which leaves the value unwritten (silent data loss)
    throwConditionAbsent({
      key,
      condition,
      found: await getSourceVersion({ directory, key }),
    });
  }
};
