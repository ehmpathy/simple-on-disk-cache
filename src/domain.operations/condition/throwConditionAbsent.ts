import type { SimpleCacheCondition } from '../../domain.objects/SimpleCacheCondition';
import { SimpleCacheConditionError } from '../../domain.objects/SimpleCacheConditionError';

/**
 * .what = throw the canonical "expected key to be absent" put-if-absent conflict error
 * .why  = this exact message is contract-mandated (mirrors with-simple-cache's reference backend)
 *         and is thrown from two sites: the assertConditionMet gate (conditionally, when a
 *         put-if-absent finds the key present) and the cloud reclaim-lost-race bypass in
 *         disk/cloud/setToCloudExpired.ts (unconditionally, since it signals a lost CAS-on-etag even
 *         when the key raced to absent).
 *         one builder keeps the exact message text in sync across both — a future edit to the
 *         message cannot silently desync the two sites.
 */
export const throwConditionAbsent = (input: {
  key: string;
  condition: SimpleCacheCondition;
  found: string | undefined;
}): never => {
  const { key, condition, found } = input;
  throw new SimpleCacheConditionError(
    'cache condition failed: expected key to be absent',
    { key, condition, found },
  );
};
