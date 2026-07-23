import type { SimpleCacheCondition } from '../../domain.objects/SimpleCacheCondition';
import { SimpleCacheConditionError } from '../../domain.objects/SimpleCacheConditionError';

/**
 * .what = throw the canonical "version mismatch" compare-and-set conflict error
 * .why  = this exact message is contract-mandated (mirrors with-simple-cache's reference backend)
 *         and is thrown from two sites: the assertConditionMet gate (when a compare-and-set finds
 *         the stored token moved) and the cloud compare-and-set path in
 *         disk/cloud/setToCloudConditional.ts (on a 412). one
 *         builder keeps the exact message text in sync across both — a future edit to the message
 *         cannot silently desync the two sites (the mismatch twin of throwConditionAbsent).
 */
export const throwConditionMismatch = (input: {
  key: string;
  condition: SimpleCacheCondition;
  found: string | undefined;
}): never => {
  const { key, condition, found } = input;
  throw new SimpleCacheConditionError(
    'cache condition failed: version mismatch',
    { key, condition, found },
  );
};
