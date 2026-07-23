import { UnexpectedCodePathError } from 'helpful-errors';

import type { DirectoryToPersistTo } from '../../../domain.objects/DirectoryToPersistTo';
import type { SimpleCacheCondition } from '../../../domain.objects/SimpleCacheCondition';
import type { SimpleOnDiskCacheCloudAdapter } from '../../../domain.objects/SimpleOnDiskCacheCloudAdapter';
import { assertConditionMet } from '../../condition/assertConditionMet';
import { throwConditionMismatch } from '../../condition/throwConditionMismatch';
import { isRecordExpired } from '../../envelope/isRecordExpired';
import { getSourceEntry } from '../getSourceEntry';
import { getSourceVersion } from '../getSourceVersion';
import { setToCloudExpired } from './setToCloudExpired';

/**
 * reconcile a cloud conditional-write precondition failure into one of three outcomes
 *
 * .what = the native conditional write hit a precondition failure; classify why and act:
 *         - compare-and-set mismatch → throw the canonical version-mismatch error
 *         - put-if-absent conflict on a live entry → throw the canonical absent-conflict error
 *         - put-if-absent conflict on an EXPIRED entry → reclaim it via compare-and-set (returns 'done')
 *         - the object raced to truly-absent → signal 'retry' so the caller re-attempts (bounded)
 * .why = pulled out of setToCloudConditional so that orchestrator stays a flat try/attempt loop and
 *        this decision tree lives in one named place (below the cognitive-complexity limit).
 */
export const reconcileCloudPreconditionFailure = async ({
  directory,
  adapter,
  uri,
  key,
  value,
  condition,
  attemptsLeft,
}: {
  directory: DirectoryToPersistTo;
  adapter: SimpleOnDiskCacheCloudAdapter;
  uri: string;
  key: string;
  value: string;
  condition: SimpleCacheCondition;
  attemptsLeft: number;
}): Promise<'retry' | 'done'> => {
  // compare-and-set mismatch — the stored etag moved; report the current token via the shared
  // message builder (the same canonical text assertConditionMet uses), so the two cannot desync
  if (condition.version !== null)
    throwConditionMismatch({
      key,
      condition,
      found: await getSourceVersion({ directory, key }),
    });

  // put-if-absent conflict — reclaim only if the present entry is now logically absent
  const entry = await getSourceEntry({ directory, key });

  // the object vanished (raced to truly-absent) — signal a bounded retry of the whole write
  if (entry === null) {
    if (attemptsLeft <= 1)
      // multi-line message (one sentence per line, `to fix:` cue) to match the local-lock
      // fail-loud convention in withLocalKeyLock.ts, so all UnexpectedCodePathError guidance
      // in this feature reads the same way. single-`\n`-joined; helpful-errors appends the
      // metadata dump after `\n\n`, so a `.split('\n\n')[0]` snapshot pins the full guidance.
      throw new UnexpectedCodePathError(
        [
          `cloud put-if-absent repeatedly raced to absent — attempts exhausted.`,
          `this is expected only if another process deletes and recreates this same key in a tight loop.`,
          `to fix: retry the operation (a transient race clears on its own), or stop the concurrent delete-and-recreate churn on this key.`,
        ].join('\n'),
        { key, uri },
      );
    return 'retry';
  }

  // present + not expired → a real held key → put-if-absent conflict (via the canonical gate)
  if (!isRecordExpired({ expiresAtMse: entry.expiresAtMse }))
    assertConditionMet({ key, condition, found: entry.version });

  // a physically-present cloud object always carries an etag (this reads with the default version) —
  // its absence is an impossible state, so fail loud rather than compare-and-set on undefined
  if (entry.version === undefined)
    throw new UnexpectedCodePathError(
      'cloud entry present but carries no etag; cannot compare-and-set to reclaim it',
      { key, uri },
    );

  // expired → reclaim atomically via compare-and-set on the current etag (exactly one wins)
  await setToCloudExpired({
    directory,
    adapter,
    uri,
    key,
    value,
    condition,
    currentEtag: entry.version,
  });
  return 'done';
};
