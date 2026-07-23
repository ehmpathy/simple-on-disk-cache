import type { SimpleCacheCondition } from '../../domain.objects/SimpleCacheCondition';
import { throwConditionAbsent } from './throwConditionAbsent';
import { throwConditionMismatch } from './throwConditionMismatch';

/**
 * .what = assert a version precondition holds against the current version
 * .why  = the shared compare-and-set gate for the on-disk cache, so the local and cloud paths
 *         check the precondition the same way; throws SimpleCacheConditionError on a miss
 *
 * note
 * - `found` is the current opaque version token (undefined when the key is logically absent)
 * - messages match with-simple-cache's reference backend so a consumer sees identical errors
 */
export const assertConditionMet = (input: {
  key: string;
  condition: SimpleCacheCondition;
  found: string | undefined;
}): void => {
  const { key, condition, found } = input;

  // must-be-absent precondition (version: null) → put-if-absent
  if (condition.version === null) {
    if (found !== undefined) throwConditionAbsent({ key, condition, found });
    return;
  }

  // must-match precondition (version: token) → compare-and-set
  if (found !== condition.version)
    throwConditionMismatch({ key, condition, found });
};
