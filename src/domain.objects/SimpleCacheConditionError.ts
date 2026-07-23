import { ConstraintError } from 'helpful-errors';

import type { SimpleCacheCondition } from './SimpleCacheCondition';

/**
 * thrown by a conditional cache's get(...) or set(...) when a condition.version precondition
 * is not met
 *
 * i.e., the key was present/absent contrary to expectation, or the version did not match
 *
 * extends ConstraintError from helpful-errors — a caller-must-fix constraint violation (exit 2)
 * - metadata.key       — the cache key the condition was checked against
 * - metadata.condition — the version precondition that was required
 * - metadata.found     — the current version token found (undefined if absent)
 *
 * note
 * - mirrors `SimpleCacheConditionError` from with-simple-cache exactly (same message + metadata
 *   shape), so a consumer that catches one catches the other. redefined here to avoid a
 *   dependency cycle (with-simple-cache depends on this package).
 */
export class SimpleCacheConditionError extends ConstraintError<{
  key: string;
  condition: SimpleCacheCondition;
  found: string | undefined;
}> {}
