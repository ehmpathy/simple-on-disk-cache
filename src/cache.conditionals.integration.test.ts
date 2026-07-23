import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { UnexpectedCodePathError } from 'helpful-errors';
import { sleep } from 'iso-time';
import { sdkAwsS3 } from 'sdk-aws-s3';
import { getError } from 'test-fns';
// types-only: proves conformance to the REAL shipped contract. `import type` is erased at
// compile, so this forms no runtime edge even though with-simple-cache lists this package as a
// dependency (declared as an optional peerDependency + a devDependency for the local typecheck).
import type {
  SimpleCacheAsync,
  WithCacheConditionals,
} from 'with-simple-cache';

import type { DirectoryToPersistTo } from './domain.objects/DirectoryToPersistTo';
import { RESERVED_CACHE_KEY_FOR_VALID_KEYS } from './domain.objects/RESERVED_CACHE_KEY_FOR_VALID_KEYS';
import { ReservedOnDiskCacheKeyError } from './domain.objects/ReservedOnDiskCacheKeyError';
import { SimpleCacheConditionError } from './domain.objects/SimpleCacheConditionError';
import type { SimpleOnDiskCacheCloudAdapter } from './domain.objects/SimpleOnDiskCacheCloudAdapter';
import { createCache } from './domain.operations/createCache';

jest.setTimeout(60 * 1000);

// the exported cache must satisfy the real WithCacheConditionals of the async string cache
type RequiredConditionalAsyncCache = WithCacheConditionals<
  SimpleCacheAsync<string>
>;

/**
 * .what = the first line of a rejection reason's message — the stable contract text
 * .why = a race loser rejects with a SimpleCacheConditionError whose full message embeds a random
 *        key + content-hash below the first line; a snapshot of only that first line pins the exact
 *        contract text (drift-detectable) without the per-run flake the metadata dump would add
 */
const asRejectionFirstLine = (reason: unknown): string =>
  reason instanceof Error
    ? (reason.message.split('\n')[0] ?? reason.message)
    : String(reason);

/**
 * .what = narrow an unknown thrown value to a SimpleCacheConditionError, or fail loud
 * .why = lets a test read the error's typed metadata ({ key, condition, found }) with no
 *        conditional branch — an unexpected type fails the test rather than a silent no-op
 */
const asConditionError = (error: unknown): SimpleCacheConditionError => {
  if (error instanceof SimpleCacheConditionError) return error;
  throw new UnexpectedCodePathError(
    `expected a SimpleCacheConditionError, got: ${String(error)} — a conditional op that misses its precondition must throw SimpleCacheConditionError; check the cache's condition gate (assertConditionMet / the cloud adapter's precondition translation)`,
    { got: String(error) },
  );
};

/**
 * run the conditional-write suite against a backend (local disk + real s3), so the same
 * put-if-absent / compare-and-set behavior is proven identically across both tiers
 */
const runConditionalSuite = (input: {
  label: string;
  directory: DirectoryToPersistTo;
}): void => {
  const { label, directory } = input;
  describe(label, () => {
    describe('version', () => {
      it('should return undefined for an absent key', async () => {
        const { version } = createCache({ directory });
        const key = `absent-${randomUUID()}`;
        expect(await version(key)).toEqual(undefined);
      });
      it('should return a stable token for a present key', async () => {
        const { set, version } = createCache({ directory });
        const key = `present-${randomUUID()}`;
        await set(key, 'hello');
        const tokenFirst = await version(key);
        const tokenSecond = await version(key);
        expect(typeof tokenFirst).toEqual('string');
        expect(tokenFirst).toBeTruthy();
        expect(tokenSecond).toEqual(tokenFirst); // stable across reads
      });
      it('should change the token after an overwrite', async () => {
        const { set, version } = createCache({ directory });
        const key = `changes-${randomUUID()}`;
        await set(key, 'before');
        const tokenBefore = await version(key);
        await set(key, 'after');
        const tokenAfter = await version(key);
        expect(tokenAfter).not.toEqual(tokenBefore);
      });
      it('should return undefined for an expired key (logically absent)', async () => {
        const { set, version } = createCache({ directory });
        const key = `expired-${randomUUID()}`;
        await set(key, 'stale', { expiration: { seconds: 1 } });
        await sleep(1500); // let it expire → logically absent
        expect(await version(key)).toEqual(undefined); // expired reads as never-cached
      });
      it('should return a token for a no-expiry key (expiration: null)', async () => {
        // .why = a no-expiry entry stores expiresAtMse as Infinity, which JSON serializes to
        //        null; the source read must treat null as "never expires" (present), NOT fold it
        //        to 0 (expired-at-epoch) — else version() would wrongly report the key absent
        const { set, version } = createCache({ directory });
        const key = `no-expiry-${randomUUID()}`;
        await set(key, 'permanent', { expiration: null });
        expect(await version(key)).toBeTruthy(); // permanently present, not falsely absent
      });
    });

    describe('put-if-absent (condition.version: null)', () => {
      it('should succeed on an open key', async () => {
        const { set, get, keys } = createCache({ directory });
        const key = `pia-open-${randomUUID()}`;
        await set(key, 'mine', { condition: { version: null } });
        const stored = await get(key);
        expect(stored).toEqual('mine');
        // positive-path contract output: a successful put-if-absent yields the written value
        expect(stored).toMatchSnapshot();
        // a conditionally-written key registers in valid_keys, same as a plain write
        expect(await keys()).toContain(key);
      });
      it('should throw SimpleCacheConditionError on a held key', async () => {
        const { set } = createCache({ directory });
        const key = `pia-held-${randomUUID()}`;
        await set(key, 'holder'); // a normally-written value counts as present
        const error = await getError(
          set(key, 'intruder', { condition: { version: null } }),
        );
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        // pin the exact contract message (first line only; the metadata dump below it carries
        // a random key + content-hash, so it is intentionally excluded from the snapshot)
        expect(error.message.split('\n')[0]).toMatchSnapshot();
      });
      it('should throw on a held no-expiry key (must not clobber it)', async () => {
        // .why = a no-expiry key is permanently present; put-if-absent must conflict, never
        //        clobber — guards the never-expires source-read path (the folded-to-0 bug)
        const { set, get } = createCache({ directory });
        const key = `pia-no-expiry-${randomUUID()}`;
        await set(key, 'holder', { expiration: null }); // permanently present
        const error = await getError(
          set(key, 'intruder', { condition: { version: null } }),
        );
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        expect(await get(key)).toEqual('holder'); // original preserved, not clobbered
      });
      it('should reclaim an expired key', async () => {
        const { set, get } = createCache({ directory });
        const key = `pia-expired-${randomUUID()}`;
        await set(key, 'stale', { expiration: { seconds: 1 } });
        await sleep(1500); // let it expire → logically absent
        await set(key, 'fresh', { condition: { version: null } }); // reclaims
        expect(await get(key)).toEqual('fresh');
      });
      it('should let exactly one racer reclaim an expired key', async () => {
        const { set, get } = createCache({ directory });
        const key = `pia-reclaim-race-${randomUUID()}`;
        await set(key, 'stale', { expiration: { seconds: 1 } });
        await sleep(1500); // expire → logically absent, so both racers try to reclaim
        const outcomes = await Promise.allSettled([
          set(key, 'racerA', { condition: { version: null } }),
          set(key, 'racerB', { condition: { version: null } }),
        ]);
        const won = outcomes.filter((o) => o.status === 'fulfilled');
        const lost = outcomes.filter(
          (o): o is PromiseRejectedResult => o.status === 'rejected',
        );
        expect(won).toHaveLength(1); // exactly one reclaims (no double-grant on expiry)
        expect(lost).toHaveLength(1); // the other observes the reclaim + conflicts
        expect(lost[0]?.reason).toBeInstanceOf(SimpleCacheConditionError); // the RIGHT error
        // pin the loser's exact contract message (first line only — the metadata dump carries a
        // random key + content-hash, intentionally excluded from the snapshot)
        expect(asRejectionFirstLine(lost[0]?.reason)).toMatchSnapshot();
        expect(['racerA', 'racerB']).toContain(await get(key));
      });
    });

    describe('compare-and-set (condition.version: token)', () => {
      it('should succeed when the stored version matches', async () => {
        const { set, get, version } = createCache({ directory });
        const key = `cas-match-${randomUUID()}`;
        await set(key, 'v1');
        const token = await version(key);
        await set(key, 'v2', { condition: { version: token ?? null } });
        const stored = await get(key);
        expect(stored).toEqual('v2');
        // positive-path contract output: a successful compare-and-set yields the new value
        expect(stored).toMatchSnapshot();
      });
      it('should throw when the stored version does not match', async () => {
        const { set, version } = createCache({ directory });
        const key = `cas-stale-${randomUUID()}`;
        await set(key, 'v1');
        const staleToken = await version(key);
        await set(key, 'v2'); // someone else moved the version forward
        const error = await getError(
          set(key, 'v3', { condition: { version: staleToken ?? null } }),
        );
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        // pin the exact contract message (first line only; the metadata dump below it carries
        // a random key + content-hash, so it is intentionally excluded from the snapshot)
        expect(error.message.split('\n')[0]).toMatchSnapshot();
      });
      it('should carry { key, condition, found } metadata on the error', async () => {
        // .why = a consumer branches on error.metadata.found to converge after losing a race, so
        //        the metadata shape is the most consumer-visible part of the contract — assert all
        //        three fields directly, not just the message
        const { set, version } = createCache({ directory });
        const key = `cas-meta-${randomUUID()}`;
        await set(key, 'v1');
        const staleToken = await version(key);
        await set(key, 'v2'); // move the version forward → staleToken now mismatches
        const currentToken = await version(key);

        const error = asConditionError(
          await getError(
            set(key, 'v3', { condition: { version: staleToken ?? null } }),
          ),
        );
        expect(error.metadata.key).toEqual(key);
        expect(error.metadata.condition).toEqual({ version: staleToken });
        expect(error.metadata.found).toEqual(currentToken); // the token the writer must re-read
      });
      it('should let exactly one of two racers win', async () => {
        const { set, version } = createCache({ directory });
        const key = `cas-race-${randomUUID()}`;
        await set(key, 'v1');
        const token = await version(key);
        const outcomes = await Promise.allSettled([
          set(key, 'a', { condition: { version: token ?? null } }),
          set(key, 'b', { condition: { version: token ?? null } }),
        ]);
        const won = outcomes.filter((o) => o.status === 'fulfilled');
        const lost = outcomes.filter(
          (o): o is PromiseRejectedResult => o.status === 'rejected',
        );
        expect(won).toHaveLength(1); // exactly one compare-and-set wins (no TOCTOU lost update)
        expect(lost).toHaveLength(1); // the other sees the moved token + conflicts
        expect(lost[0]?.reason).toBeInstanceOf(SimpleCacheConditionError); // the RIGHT error
        // pin the loser's exact contract message (first line only — metadata dump excluded)
        expect(asRejectionFirstLine(lost[0]?.reason)).toMatchSnapshot();
      });
      it('should throw against a truly-absent key with a real token', async () => {
        const { set } = createCache({ directory });
        const key = `cas-absent-${randomUUID()}`; // never written → truly absent
        const error = await getError(
          set(key, 'v1', {
            condition: { version: 'a-token-for-a-key-that-vanished' },
          }),
        );
        // found === undefined !== token → the target we meant to update is gone → conflict
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        // pin the exact contract message (first line only; the metadata dump below it carries
        // a random key + content-hash, so it is intentionally excluded from the snapshot)
        expect(error.message.split('\n')[0]).toMatchSnapshot();
      });
    });

    describe('compare-and-delete (set undefined + condition)', () => {
      it('should delete when the version matches, then read as absent', async () => {
        const { set, get, version, keys } = createCache({ directory });
        const key = `cad-${randomUUID()}`;
        await set(key, 'held');
        const token = await version(key);
        await set(key, undefined, { condition: { version: token ?? null } });
        expect(await get(key)).toEqual(undefined);
        expect(await version(key)).toEqual(undefined);
        expect(await keys()).not.toContain(key);
      });
      it('should throw against a stale token and leave the value intact', async () => {
        // lock-safety: a compare-and-delete is the release half of a distributed lock. a delete
        // that carries a stale token (someone else already rotated the value) MUST be rejected —
        // a silent stale-token delete would let a caller free a lock it no longer holds.
        const { set, get, version } = createCache({ directory });
        const key = `cad-stale-${randomUUID()}`;
        await set(key, 'v1');
        const staleToken = await version(key); // the token a slow holder read
        await set(key, 'v2'); // a concurrent writer rotates the value (mints a fresh token)
        const error = await getError(
          set(key, undefined, { condition: { version: staleToken ?? null } }),
        );
        // found (v2's token) !== staleToken → the delete is rejected, not applied
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        // pin the exact contract message (first line only — metadata dump excluded)
        expect(asRejectionFirstLine(error)).toMatchSnapshot();
        expect(await get(key)).toEqual('v2'); // the fresh value survives, no lost delete
      });
    });

    describe('get with condition', () => {
      it('should throw on a version mismatch', async () => {
        const { set, get } = createCache({ directory });
        const key = `get-cond-${randomUUID()}`;
        await set(key, 'v1');
        const error = await getError(
          get(key, { condition: { version: 'not-the-real-token' } }),
        );
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        // pin the exact contract message (first line only; the metadata dump below it carries
        // a random key + content-hash, so it is intentionally excluded from the snapshot)
        expect(error.message.split('\n')[0]).toMatchSnapshot();
      });
      it('should return the value when the version matches', async () => {
        const { set, get, version } = createCache({ directory });
        const key = `get-cond-ok-${randomUUID()}`;
        await set(key, 'v1');
        const token = await version(key);
        const stored = await get(key, {
          condition: { version: token ?? null },
        });
        expect(stored).toEqual('v1');
        // positive-path contract output: a matched conditional get yields the stored value
        expect(stored).toMatchSnapshot();
      });
      it('should return undefined for condition.version: null against an absent key (no throw)', async () => {
        // the type permits `condition: { version: null }` on get too; against an absent key the
        // "expect absent" precondition is met, so it must not throw — it just reads as undefined
        const { get } = createCache({ directory });
        const key = `get-cond-absent-${randomUUID()}`;
        // no snapshot here: the `undefined` output shape of this read-if-absent guard is already
        // pinned at the acceptance layer (`satisfies a read-if-absent guard on a truly absent key`),
        // so a duplicate pin would add no vibecheck value — a functional assertion suffices
        expect(await get(key, { condition: { version: null } })).toEqual(
          undefined,
        );
      });
      it('should throw for condition.version: null against a present key', async () => {
        // symmetry with the set-side put-if-absent-held test: a get with the must-be-absent
        // precondition against a PRESENT key must throw (the absent-key no-throw case above only
        // covered one half of the same assertConditionMet gate)
        const { set, get } = createCache({ directory });
        const key = `get-cond-present-${randomUUID()}`;
        await set(key, 'here');
        const error = await getError(
          get(key, { condition: { version: null } }),
        );
        expect(error).toBeInstanceOf(SimpleCacheConditionError);
        // pin the exact contract message (first line only — metadata dump excluded)
        expect(asRejectionFirstLine(error)).toMatchSnapshot();
      });
    });

    // .note = the race tests run both racers in one node process against one cache directory. this
    //         is a faithful proxy — the lock primitive (fs.link) is genuinely cross-process-safe —
    //         but true multi-os-process fidelity is an assumption these tests do not directly prove.
    describe('concurrent put-if-absent', () => {
      it('should let exactly one of two racers win', async () => {
        const { set, get } = createCache({ directory });
        const key = `race-${randomUUID()}`;
        const outcomes = await Promise.allSettled([
          set(key, 'racerA', { condition: { version: null } }),
          set(key, 'racerB', { condition: { version: null } }),
        ]);
        const won = outcomes.filter((o) => o.status === 'fulfilled');
        const lost = outcomes.filter(
          (o): o is PromiseRejectedResult => o.status === 'rejected',
        );
        expect(won).toHaveLength(1); // exactly one winner
        expect(lost).toHaveLength(1); // exactly one loser
        expect(lost[0]?.reason).toBeInstanceOf(SimpleCacheConditionError); // the RIGHT error
        // pin the loser's exact contract message (first line only — metadata dump excluded)
        expect(asRejectionFirstLine(lost[0]?.reason)).toMatchSnapshot();
        const value = await get(key);
        expect(['racerA', 'racerB']).toContain(value); // the winner's value stuck
      });

      it('should let exactly one of N racers win under queue depth', async () => {
        // .why = the 2-racer test proves the primitive; this proves it holds under DEPTH — N
        //        simultaneous put-if-absent racers on one key, all queued on the same local lock.
        //        exactly one must win and N-1 must lose with the conflict error, so the lock's
        //        queue-and-serialize behavior is exercised past the trivial two-way contention.
        const { set, get } = createCache({ directory });
        const key = `race-n-${randomUUID()}`;
        const racerCount = 8;
        const racers = Array.from({ length: racerCount }, (_, index) =>
          set(key, `racer-${index}`, { condition: { version: null } }),
        );
        const outcomes = await Promise.allSettled(racers);
        const won = outcomes.filter((o) => o.status === 'fulfilled');
        const lost = outcomes.filter(
          (o): o is PromiseRejectedResult => o.status === 'rejected',
        );
        expect(won).toHaveLength(1); // exactly one winner, no matter the depth
        expect(lost).toHaveLength(racerCount - 1); // every other racer lost
        // every loss is the RIGHT error — a conflict, never a lock-deadline or a torn write
        for (const loss of lost)
          expect(loss.reason).toBeInstanceOf(SimpleCacheConditionError);
        // the winner's value is the one that stuck
        const value = await get(key);
        expect(
          Array.from({ length: racerCount }, (_, index) => `racer-${index}`),
        ).toContain(value);
      });
    });

    describe('plain set racing a compare-and-set', () => {
      it('should stay coherent — never a torn value or a swallowed conflict', async () => {
        // .why = a plain (unconditional) set and a compare-and-set on the same key must
        //        serialize; the cas either commits atomically or observes the moved version
        //        and conflicts — it can never silently lose its update to an interleaved plain
        //        write (the local-tier lost-update gap; the cloud tier's native put precludes it)
        const { set, get, version } = createCache({ directory });
        const key = `plain-vs-cas-${randomUUID()}`;
        await set(key, 'v1');
        const token = await version(key);
        const outcomes = await Promise.allSettled([
          set(key, 'plain'), // unconditional, last-writer-wins
          set(key, 'cas', { condition: { version: token ?? null } }), // optimistic
        ]);
        // the plain write always commits; the cas either commits or conflicts (no other outcome)
        const [plainOutcome, casOutcome] = outcomes;
        expect(plainOutcome.status).toEqual('fulfilled');
        if (casOutcome.status === 'rejected')
          expect(casOutcome.reason).toBeInstanceOf(SimpleCacheConditionError);
        // the stored value is always one of the two writers' — never torn or absent
        expect(['plain', 'cas']).toContain(await get(key));
      });
    });

    describe('two plain sets racing (both unconditional)', () => {
      it('should serialize under the lock — one complete value wins, never torn', async () => {
        // .why = the per-key lock now serializes EVERY local write, including two plain
        //        (unconditional) writers to one key. they must neither deadlock nor tear — the
        //        stored value is exactly one writer's, complete (the lock's blast radius reaches
        //        the plain-vs-plain path, not only plain-vs-conditional)
        const { set, get } = createCache({ directory });
        const key = `plain-vs-plain-${randomUUID()}`;
        const outcomes = await Promise.allSettled([
          set(key, 'writerA'),
          set(key, 'writerB'),
        ]);
        // both unconditional writes succeed (last-writer-wins — no conflict, no deadlock)
        expect(outcomes.every((o) => o.status === 'fulfilled')).toEqual(true);
        // the stored value is exactly one writer's complete value — never torn or absent
        expect(['writerA', 'writerB']).toContain(await get(key));
      });
    });

    describe('get with condition on a memory-first cache', () => {
      it('should serve the fresh source value, not a stale in-memory copy', async () => {
        // .why = a conditional read gates on the source version; the value it returns must be
        //        source-first too, else it could pass its version check yet hand back a memory
        //        copy that was never at that version (the memory-first conditional-read gap)
        const cacheWarm = createCache({
          directory,
          consistency: 'memory-first',
        });
        const cacheOther = createCache({ directory }); // separate instance = separate memory
        const key = `get-cond-mem-${randomUUID()}`;

        await cacheWarm.set(key, 'v1'); // warms cacheWarm's memory with v1
        expect(await cacheWarm.get(key)).toEqual('v1'); // memory now holds v1
        await cacheOther.set(key, 'v2'); // source advances to v2; cacheWarm memory still v1

        const token = await cacheWarm.version(key); // source-first → the v2 token
        // conditional get must return the source value at the verified token, not stale memory
        expect(
          await cacheWarm.get(key, { condition: { version: token ?? null } }),
        ).toEqual('v2');
      });
      it('should warm memory after a conditional read, like the source-first override', async () => {
        // .why = a conditional read forces a source read; on a memory-first cache it must also
        //        refresh the in-memory copy (as the explicit source-first override does), else a
        //        following plain get could still serve the stale memory value it just superseded
        const cacheWarm = createCache({
          directory,
          consistency: 'memory-first',
        });
        const cacheOther = createCache({ directory }); // separate instance = separate memory
        const key = `get-cond-warm-${randomUUID()}`;

        await cacheWarm.set(key, 'v1'); // warms cacheWarm's memory with v1
        expect(await cacheWarm.get(key)).toEqual('v1'); // memory now holds v1
        await cacheOther.set(key, 'v2'); // source advances to v2; cacheWarm memory still v1

        const token = await cacheWarm.version(key); // source-first → the v2 token
        await cacheWarm.get(key, { condition: { version: token ?? null } }); // reads + warms

        // a later plain (memory-first) get must now see v2, not the stale v1 it warmed earlier
        expect(await cacheWarm.get(key)).toEqual('v2');
      });
      it('should ignore an explicit per-call memory-first consistency when condition is also passed', async () => {
        // .why = when BOTH options are passed in one call — get(key, { consistency, condition }) —
        //        condition wins: a conditional read must arbitrate off the source, so an explicit
        //        per-call `consistency: 'memory-first'` is overridden (documented on SimpleOnDiskCache.get).
        //        prove it directly: even with consistency memory-first in the SAME call, the stale
        //        memory copy is bypassed and the fresh source value is served.
        const cacheWarm = createCache({
          directory,
          consistency: 'memory-first',
        });
        const cacheOther = createCache({ directory }); // separate instance = separate memory
        const key = `get-cond-both-opts-${randomUUID()}`;

        await cacheWarm.set(key, 'v1'); // warms cacheWarm's memory with v1
        expect(await cacheWarm.get(key)).toEqual('v1'); // memory now holds v1
        await cacheOther.set(key, 'v2'); // source advances to v2; cacheWarm memory still v1

        const token = await cacheWarm.version(key); // source-first → the v2 token
        // pass consistency AND condition together: condition forces source-first, so v2 (not stale v1)
        expect(
          await cacheWarm.get(key, {
            consistency: 'memory-first',
            condition: { version: token ?? null },
          }),
        ).toEqual('v2');
      });
    });

    describe('set with condition on a memory-first cache', () => {
      // .why = the vision's edgecase table requires conditional ops to look the token up source-first
      //        "then refresh memory after the write". the get side is covered above; these prove the
      //        SET side — a conditional write must warm (or clear) the in-memory tier so a later plain
      //        memory-first get reflects the write, never a pre-write stale copy.
      it('should warm memory after a put-if-absent set, so a later plain get sees the written value', async () => {
        const cacheWarm = createCache({
          directory,
          consistency: 'memory-first',
        });
        const cacheOther = createCache({ directory }); // separate instance = separate memory
        const key = `set-cond-pia-mem-${randomUUID()}`;

        // put-if-absent write on the memory-first cache
        await cacheWarm.set(key, 'v1', { condition: { version: null } });

        // advance the SOURCE to v2 via the other instance; cacheWarm's memory must hold v1 from its
        // own conditional write. a plain memory-first get returns the warmed v1 (memory hit), which
        // proves the conditional set refreshed memory — else it would fall to the source and see v2.
        await cacheOther.set(key, 'v2');
        expect(await cacheWarm.get(key)).toEqual('v1');
      });
      it('should warm memory after a compare-and-set write, so a later plain get sees the new value', async () => {
        const cacheWarm = createCache({
          directory,
          consistency: 'memory-first',
        });
        const cacheOther = createCache({ directory }); // separate instance = separate memory
        const key = `set-cond-cas-mem-${randomUUID()}`;

        await cacheWarm.set(key, 'v1'); // seed the key + warm memory with v1
        const token = await cacheWarm.version(key); // source-first → the v1 token
        await cacheWarm.set(key, 'v2', {
          condition: { version: token ?? null },
        }); // compare-and-set

        // advance the SOURCE to v3; the memory-first get must return the v2 the CAS just warmed
        await cacheOther.set(key, 'v3');
        expect(await cacheWarm.get(key)).toEqual('v2');
      });
      it('should not serve the deleted value after a compare-and-delete', async () => {
        const cacheWarm = createCache({
          directory,
          consistency: 'memory-first',
        });
        const key = `set-cond-del-mem-${randomUUID()}`;

        await cacheWarm.set(key, 'v1'); // warm memory with v1
        expect(await cacheWarm.get(key)).toEqual('v1'); // memory holds v1

        // compare-and-delete only this version; the memory-first tier must no longer serve v1
        const token = await cacheWarm.version(key);
        await cacheWarm.set(key, undefined, {
          condition: { version: token ?? null },
        });
        expect(await cacheWarm.get(key)).toEqual(undefined);
      });
    });

    // the vision's "aha moment" is the full mutex lifecycle: acquire (put-if-absent) → release
    // (compare-and-delete) → reacquire. each primitive is tested in isolation above; this chains
    // them on one key as the composed flow the headline usecase actually runs.
    describe('full lock lifecycle (acquire → release → reacquire)', () => {
      it('should let a second holder reacquire after the first releases', async () => {
        const { set, get, version } = createCache({ directory });
        const key = `lock-cycle-${randomUUID()}`;

        // acquire: holderA wins the empty lock via put-if-absent
        await set(key, 'holderA', { condition: { version: null } });
        expect(await get(key)).toEqual('holderA');

        // a second acquire while held must conflict — the lock is taken
        const errorWhileHeld = await getError(
          set(key, 'holderB', { condition: { version: null } }),
        );
        expect(errorWhileHeld).toBeInstanceOf(SimpleCacheConditionError);

        // release: holderA deletes only its own version (compare-and-delete)
        const tokenA = await version(key);
        await set(key, undefined, { condition: { version: tokenA ?? null } });
        expect(await get(key)).toEqual(undefined);

        // reacquire: holderB now wins the freed lock via put-if-absent
        await set(key, 'holderB', { condition: { version: null } });
        expect(await get(key)).toEqual('holderB');
      });
    });
  });
};

describe('cache conditionals', () => {
  describe('type conformance', () => {
    it('should satisfy the WithCacheConditionals async-cache shape', () => {
      const cache = createCache({
        directory: { local: { path: `${__dirname}/__tmp__` } },
      });
      // compile-time assertion: the exported cache is a conditional async cache
      const conforms: RequiredConditionalAsyncCache = cache;
      expect(typeof conforms.version).toEqual('function');
      expect(typeof conforms.get).toEqual('function');
      expect(typeof conforms.set).toEqual('function');
    });
  });

  runConditionalSuite({
    label: 'local',
    directory: { local: { path: `${__dirname}/__tmp__` } },
  });
  // credential gate (fail-loud on absent creds, per rule.require.failfast / rule.forbid.integration.mocks):
  // the cloud suite hits real s3. absent creds are NOT a silent skip — the suite fails loud via the
  // test runner's keyrack unlock, which precedes the suite and throws a ConstraintError
  // ("✋ ConstraintError: aws sso login timed out …") when creds are absent, so the whole suite halts.
  // an in-file `if (!process.env.AWS_ACCESS_KEY_ID) throw` guard is deliberately NOT added: this repo
  // authenticates via aws sso / AWS_PROFILE, so AWS_ACCESS_KEY_ID is never populated even on a valid
  // session — such a guard would false-negative and break valid runs. cred-unlock-as-prerequisite is
  // the repo convention (ref.reviewer.test-infrastructure-context: defer to convention, do not flag).
  runConditionalSuite({
    label: 'cloud',
    directory: {
      cloud: {
        path: 's3://ehmpathy-simple-on-disk-cache-test-bucket/test/integration/conditionals/',
        via: sdkAwsS3,
      },
    },
  });

  // a legacy (pre-feature) entry has no version machinery in its envelope; the token is a hash of
  // its canonical value, so it must still count as logically present — else a put-if-absent on an
  // upgrade would clobber real data (vision assumption #5). local-only: it writes raw bytes to the local disk.
  describe('legacy versionless envelope (local)', () => {
    const directory = { local: { path: `${__dirname}/__tmp__` } };
    it('should treat a versionless envelope as present (put-if-absent throws)', async () => {
      const { set, version } = createCache({ directory });
      const key = `legacy-${randomUUID()}`;

      // write a raw envelope with NO version field, as a prior cache release would have
      const legacyEnvelope = JSON.stringify({
        expiresAtMse: Date.now() + 60_000, // far future → not expired
        deserializedForObservability: false,
        value: 'legacy-value',
      });
      await fs.writeFile(`${directory.local.path}/${key}`, legacyEnvelope, {
        encoding: 'utf-8',
      });

      // the content-hash token is computable off the canonical value, so the key reads as present
      expect(await version(key)).toBeTruthy();

      // therefore a put-if-absent must conflict, not clobber the legacy data
      const error = await getError(
        set(key, 'intruder', { condition: { version: null } }),
      );
      expect(error).toBeInstanceOf(SimpleCacheConditionError);
    });

    // a conditional get verifies the token against the physical source, then must return the
    // physical value at that token — not consult the valid_keys index (which a raw-written entry
    // is absent from). else a passed precondition could still yield undefined (r10-b1).
    it('should return the source value for a present-but-unregistered key', async () => {
      const { get, version } = createCache({ directory });
      const key = `unregistered-${randomUUID()}`;

      // write a raw envelope directly to disk, bypassing valid_keys registration
      const rawEnvelope = JSON.stringify({
        expiresAtMse: Date.now() + 60_000, // far future → not expired
        deserializedForObservability: false,
        value: 'source-value',
      });
      await fs.writeFile(`${directory.local.path}/${key}`, rawEnvelope, {
        encoding: 'utf-8',
      });

      // the physical token is readable even though the key is not in valid_keys
      const token = await version(key);
      expect(token).toBeTruthy();

      // a conditional get at that token must return the source value, not undefined
      expect(await get(key, { condition: { version: token! } })).toEqual(
        'source-value',
      );
    });
  });

  // the local disk token is a content hash of the canonical value — NOT of the stored bytes (which
  // embed a per-write wall-clock expiresAtMse). so two writes of byte-identical content yield the
  // same token, a mirror of s3's content etag (vision assumption #1). local-only: the cloud disk's
  // etag is server-minted over the stored body, so this content-hash guarantee is local-disk-specific.
  describe('content-hash token (local)', () => {
    const directory = { local: { path: `${__dirname}/__tmp__` } };
    it('should yield the same token for two writes of identical content', async () => {
      const { set, version } = createCache({ directory });
      const key = `content-hash-${randomUUID()}`;

      // write the same value twice, under a default ttl (distinct wall-clock instants)
      await set(key, 'same-content');
      const tokenFirst = await version(key);
      await sleep(20); // ensure a fresh expiresAtMse would be baked in, were it hashed
      await set(key, 'same-content');
      const tokenSecond = await version(key);

      // identical content ⇒ identical token, despite the fresh embedded expiry
      expect(tokenFirst).toBeTruthy();
      expect(tokenSecond).toEqual(tokenFirst);
    });
    it('should compute a deterministic token from the canonical value', async () => {
      // the local disk token is asLocalVersionToken (a hash of the canonical value) — a pure hash of a fixed value
      // string, so it is fully reproducible run-to-run (no wall-clock, no salt); pin it via
      // snapshot. cloud is excluded: its etag is server-minted, not provably deterministic across runs.
      const { set, version } = createCache({ directory });
      const key = `token-snap-${randomUUID()}`;
      await set(key, 'deterministic-value');
      expect(await version(key)).toMatchSnapshot();
    });
  });

  // compare-and-set against a token that WAS valid but has since expired. local-only on purpose:
  // the local tier derives `found` through getSourceVersion, which honors LOGICAL expiry (an expired
  // entry reads as absent → found undefined ≠ the once-valid token → mismatch), a mirror of the vision
  // ("expired == absent", CAS against an absent target throws). the cloud tier can NOT prove the same
  // deterministically: s3's native compare-and-set gates on the PHYSICAL etag, which is unchanged for
  // a physically-present-but-logically-expired object, so a CAS with the once-valid etag succeeds
  // there. that is a defensible tier difference (cloud CAS = physical-etag optimistic concurrency,
  // local CAS = logical-expiry), not corruption — so this expiry-specific gate is asserted on the tier
  // that owns the logical-expiry read.
  describe('compare-and-set against an expired token (local)', () => {
    const directory = { local: { path: `${__dirname}/__tmp__` } };
    it('should throw when the token was valid but has since expired', async () => {
      const { set, version } = createCache({ directory });
      const key = `cas-expired-token-${randomUUID()}`;
      await set(key, 'v1', { expiration: { seconds: 1 } });
      const tokenOnceValid = await version(key); // a real, once-current token (local write is instant)
      expect(tokenOnceValid).toBeTruthy();
      await sleep(1500); // the entry expires → logically absent
      const error = await getError(
        set(key, 'v2', { condition: { version: tokenOnceValid ?? null } }),
      );
      // found is now undefined (expired) ≠ the once-valid token → the writer learns its target vanished
      expect(error).toBeInstanceOf(SimpleCacheConditionError);
    });
  });

  // the public surface (get/set/version) must reject the internal valid-keys sentinel key — a caller
  // that read/wrote it could corrupt the index. the guard is unit-tested at assertIsNotReservedCacheKey,
  // but version() is a NEW public entry point, so prove all three reject it end-to-end. local-only:
  // the guard runs before any tier dispatch, so one tier's proof covers the behavior.
  describe('reserved key guard on the public surface (local)', () => {
    const directory = { local: { path: `${__dirname}/__tmp__` } };
    it('should throw ReservedOnDiskCacheKeyError from get, set, and version', async () => {
      const { get, set, version } = createCache({ directory });
      const key = RESERVED_CACHE_KEY_FOR_VALID_KEYS;
      expect(await getError(get(key))).toBeInstanceOf(
        ReservedOnDiskCacheKeyError,
      );
      expect(await getError(set(key, 'x'))).toBeInstanceOf(
        ReservedOnDiskCacheKeyError,
      );
      expect(await getError(version(key))).toBeInstanceOf(
        ReservedOnDiskCacheKeyError,
      );
    });
  });

  // proves the documented cloud/local token divergence on the REAL s3 tier (not by prose alone):
  // the cloud token is s3's etag over the WHOLE serialized envelope, which embeds a fresh wall-clock
  // expiresAtMse per write — so two writes of identical content under a real TTL yield DIFFERENT
  // tokens. this is the robust, always-true half of the divergence (different bytes → different etag,
  // regardless of s3 encryption config); the mirror half (identical content ⇒ identical token) holds
  // on cloud only under expiration:null and is the local tier's guarantee, proven in
  // `content-hash token (local)`.
  describe('content token divergence (cloud, real s3)', () => {
    const cloudDirectory: DirectoryToPersistTo = {
      cloud: {
        path: 's3://ehmpathy-simple-on-disk-cache-test-bucket/test/integration/conditionals/',
        via: sdkAwsS3,
      },
    };
    it('should mint different tokens for identical content under a TTL (the token embeds expiry)', async () => {
      const { set, version } = createCache({ directory: cloudDirectory });
      const keyA = `cloud-etag-ttl-a-${randomUUID()}`;
      const keyB = `cloud-etag-ttl-b-${randomUUID()}`;
      await set(keyA, 'same-content', { expiration: { seconds: 60 } });
      await sleep(20); // ensure a distinct wall-clock expiresAtMse is embedded in the second envelope
      await set(keyB, 'same-content', { expiration: { seconds: 60 } });
      const tokenA = await version(keyA);
      const tokenB = await version(keyB);
      expect(tokenA).toBeTruthy();
      expect(tokenB).toBeTruthy();
      // identical value, different embedded expiry → different serialized bytes → different etag,
      // unlike the local tier whose content-hash token ignores expiry
      expect(tokenA).not.toEqual(tokenB);
    });
  });

  // every local conditional write serializes under a per-key O_EXCL lock file (`${key}#lock`).
  // a lock left by a crashed holder is stolen once older than LOCAL_LOCK_STALE_MSE (30s); a live
  // lock that never frees fails loud past LOCAL_LOCK_DEADLINE_MSE (5s). both are new failure
  // surfaces — exercised here by a hand-planted lock file, no real crash needed. local-only.
  describe('local key lock reclaim + deadline', () => {
    const directory = { local: { path: `${__dirname}/__tmp__` } };
    it('should reclaim a stale lock and complete the write', async () => {
      const { set, get } = createCache({ directory });
      const key = `stale-lock-${randomUUID()}`;

      // plant a lock file whose timestamp is far past the stale threshold (its holder "crashed")
      const staleHeldAtMse = Date.now() - 120_000; // 2 min old ≫ 30s stale bound
      await fs.writeFile(
        `${directory.local.path}/${key}#lock`,
        String(staleHeldAtMse),
        { encoding: 'utf-8' },
      );

      // a put-if-absent must steal the stale lock, then succeed (the key itself is absent)
      await set(key, 'reclaimed', { condition: { version: null } });
      expect(await get(key)).toEqual('reclaimed');
    });
    it('should fail loud when a live lock never frees before the deadline', async () => {
      const { set } = createCache({ directory });
      const key = `live-lock-${randomUUID()}`;

      // plant a fresh lock (a live holder) — never stale within the deadline, so it is never stolen
      await fs.writeFile(
        `${directory.local.path}/${key}#lock`,
        String(Date.now()),
        { encoding: 'utf-8' },
      );

      // the write spins to the deadline, then fails loud rather than hang forever
      const error = await getError(
        set(key, 'blocked', { condition: { version: null } }),
      );
      expect(error).toBeTruthy();
      expect(error?.message).toContain('deadline');
      // lock the actionable remediation guidance functionally, so a future regression that drops it
      // is caught even if the snapshot is re-generated (the guidance is the whole point of the loud fail)
      expect(error?.message).toContain('to fix: retry the operation');
      expect(error?.message).toContain('the local tier is per-machine');
      // pin the FULL static message — all four sentences (the message part, single-`\n`-joined), split
      // on the `\n\n` that separates it from the metadata dump (a random lockPath), so the guidance is
      // visible in the .snap for drift review while the random metadata stays out
      expect(error?.message.split('\n\n')[0]).toMatchSnapshot();
    });
    it('should reclaim a stale lock for a PLAIN (unconditional) set too', async () => {
      // .why = the readme promises the per-key lock affects EVERY local write, "even one that never
      //        uses condition". prove it directly: a plain set() against a stale lock must reclaim it
      //        and complete — not just a conditional set (the two share one withLocalKeyLock path,
      //        but the plain path is what the docs call out and it was only proven by symmetry before)
      const { set, get } = createCache({ directory });
      const key = `plain-stale-lock-${randomUUID()}`;

      // plant a lock file whose timestamp is far past the stale threshold (its holder "crashed")
      await fs.writeFile(
        `${directory.local.path}/${key}#lock`,
        String(Date.now() - 120_000), // 2 min old ≫ 30s stale bound
        { encoding: 'utf-8' },
      );

      // a PLAIN set (no condition) must steal the stale lock, then commit
      await set(key, 'plain-reclaimed');
      expect(await get(key)).toEqual('plain-reclaimed');
    });
    it('should fail loud for a PLAIN (unconditional) set when a live lock never frees', async () => {
      // .why = the deadline fail-loud is the other half of the "affects ALL local writes" promise;
      //        prove a plain set() also fails loud (never hangs) against a live lock, not only a
      //        conditional one
      const { set } = createCache({ directory });
      const key = `plain-live-lock-${randomUUID()}`;

      // plant a fresh lock (a live holder) — never stale within the deadline, so it is never stolen
      await fs.writeFile(
        `${directory.local.path}/${key}#lock`,
        String(Date.now()),
        { encoding: 'utf-8' },
      );

      // the plain write spins to the deadline, then fails loud rather than hang forever
      const error = await getError(set(key, 'plain-blocked'));
      expect(error).toBeTruthy();
      expect(error?.message).toContain('deadline');
    });
  });

  // a cloud adapter that structurally satisfies the type but does NOT enforce `condition` would
  // silently downgrade a conditional write to last-writer-wins — the exact lost-update this feature
  // prevents. the cache demands the adapter confirm the write via meta.etag; an adapter that
  // returns void must fail loud (mirrors the get-path guard), so no non-conformant adapter passes.
  describe('non-conformant cloud adapter (fail-loud)', () => {
    it('should fail loud when a conditional set returns no meta.etag', async () => {
      // a deliberately-non-conformant adapter: it ignores `condition` and returns void (never meta)
      const adapterNonConformant: SimpleOnDiskCacheCloudAdapter = {
        get: { one: async () => null }, // always absent
        set: async () => undefined, // ignores condition + include.meta → downgrade risk
      };
      const directory: DirectoryToPersistTo = {
        cloud: { path: 's3://unused/', via: adapterNonConformant },
      };
      const { set } = createCache({ directory });

      // a put-if-absent must not silently "succeed" — the absent meta.etag is a loud failure
      const error = await getError(
        set(`nonconformant-${randomUUID()}`, 'v', {
          condition: { version: null },
        }),
      );
      expect(error).toBeTruthy();
      expect(error?.message).toContain('include.meta'); // functional assertion
      // + pin the FULL fail-loud guidance (all sentences, single-`\n`-joined), split on the
      // `\n\n` that precedes the metadata dump — matches the withLocalKeyLock convention so the
      // multi-line `to fix:` guidance is visible in the .snap for drift review
      expect(error?.message.split('\n\n')[0]).toMatchSnapshot();
    });

    // a conformant custom adapter (GCS, Azure, a test double) reports a precondition failure by a
    // thrown SimpleCacheConditionError. the cache must propagate it as the one error contract —
    // recognized cross-package via the structural guard, not duck-typed on sdk-aws-s3's class names.
    it("should propagate a conformant adapter's own SimpleCacheConditionError", async () => {
      // a foreign copy of the class (a different constructor with the same name), as another
      // package would declare it to avoid the dependency cycle
      class SimpleCacheConditionError extends Error {}
      const adapterConformant: SimpleOnDiskCacheCloudAdapter = {
        get: { one: async () => null },
        set: async () => {
          throw new SimpleCacheConditionError('cache condition failed');
        },
      };
      const directory: DirectoryToPersistTo = {
        cloud: { path: 's3://unused/', via: adapterConformant },
      };
      const { set } = createCache({ directory });

      // the adapter's own condition error must surface — recognized by name, not swallowed or
      // rethrown as a non-condition error
      const error = await getError(
        set(`conformant-${randomUUID()}`, 'v', {
          condition: { version: null },
        }),
      );
      expect(error?.constructor?.name).toEqual('SimpleCacheConditionError');
    });

    // the adapter `get` supports two call styles: namespace (`{ one: fn }`, used by sdkAwsS3) and
    // direct-function (`get: fn`). every other fixture uses namespace style, so the direct-function
    // branch of getFromAdapterRaw — plus the include.meta path version() drives — is exercised here.
    it('should read the version token via a direct-function get adapter', async () => {
      const store = new Map<string, string>();
      const adapterDirectFn: SimpleOnDiskCacheCloudAdapter = {
        // direct-function style (not `{ one }`); honors include.meta with a body + etag result
        get: async ({ uri, include }) => {
          const body = store.get(uri);
          if (body === undefined) return null;
          return include?.meta
            ? { body, meta: { etag: `etag:${body}` } }
            : body;
        },
        set: async ({ uri, body, include }) => {
          store.set(uri, body);
          return include?.meta ? { meta: { etag: `etag:${body}` } } : undefined;
        },
      };
      const directory: DirectoryToPersistTo = {
        cloud: { path: 's3://unused/', via: adapterDirectFn },
      };
      const { set, version } = createCache({ directory });
      const key = `direct-fn-${randomUUID()}`;

      // version() drives getFromAdapterWithMeta → the direct-function branch with include.meta
      await set(key, 'hello');
      expect(await version(key)).toBeTruthy(); // the server-minted etag surfaces
    });

    // the mirror of the set-side non-conformance test, for the READ path: an adapter whose get
    // returns a plain string even when include.meta is requested cannot surface the etag, so
    // version() (and any conditional read) must fail loud rather than invent a token.
    it('should fail loud on version() when the get adapter ignores include.meta', async () => {
      const adapterNoMeta: SimpleOnDiskCacheCloudAdapter = {
        get: { one: async () => 'body-without-meta' }, // ignores include.meta → never an etag
        set: async () => ({ meta: { etag: 'etag:x' } }),
      };
      const directory: DirectoryToPersistTo = {
        cloud: { path: 's3://unused/', via: adapterNoMeta },
      };
      const { version } = createCache({ directory });

      const error = await getError(version(`no-meta-${randomUUID()}`));
      expect(error).toBeTruthy();
      expect(error?.message).toContain('include.meta'); // functional assertion
      // + pin the FULL fail-loud guidance (all sentences, single-`\n`-joined), split on the
      // `\n\n` that precedes the metadata dump — matches the withLocalKeyLock convention so the
      // multi-line `to fix:` guidance is visible in the .snap for drift review
      expect(error?.message.split('\n\n')[0]).toMatchSnapshot();
    });

    // the bounded-retry exhaustion guard: an adapter whose conditional set always reports a
    // put-if-absent conflict, yet whose get always reports the object absent, makes every retry
    // re-race to absent — the bounded loop (CLOUD_RECLAIM_MAX_ATTEMPTS) must fail loud, not spin.
    it('should fail loud when cloud put-if-absent keeps racing to absent', async () => {
      // a plain class named for sdk-aws-s3's put-if-absent conflict → recognized by class name
      class S3ConditionalConflictError extends Error {}
      const adapterAlwaysRacesToAbsent: SimpleOnDiskCacheCloudAdapter = {
        get: { one: async () => null }, // always absent → the "vanished, retry" branch
        set: async () => {
          throw new S3ConditionalConflictError('conflict'); // precondition conflict every write
        },
      };
      const directory: DirectoryToPersistTo = {
        cloud: { path: 's3://unused/', via: adapterAlwaysRacesToAbsent },
      };
      const { set } = createCache({ directory });

      const error = await getError(
        set(`exhaust-${randomUUID()}`, 'v', { condition: { version: null } }),
      );
      expect(error).toBeTruthy();
      expect(error?.message).toContain('attempts exhausted'); // functional assertion
      // + pin the FULL fail-loud guidance (all sentences, single-`\n`-joined), split on the
      // `\n\n` that precedes the metadata dump — matches the withLocalKeyLock convention so the
      // multi-line `to fix:` guidance is visible in the .snap for drift review
      expect(error?.message.split('\n\n')[0]).toMatchSnapshot();
    });
  });

  // a corrupt (unparseable) envelope must read as logically absent for conditional ops too — not
  // just plain get. local-only: it plants raw non-json bytes on the local disk (the cloud tier's corrupt
  // path classifies via expiresAtMse: 0, which reaches the same external "absent" result).
  describe('corrupt envelope × conditional ops (local)', () => {
    const directory = { local: { path: `${__dirname}/__tmp__` } };
    it('should treat a corrupt file as absent (version undefined, put-if-absent succeeds)', async () => {
      const { set, get, version } = createCache({ directory });
      const key = `corrupt-cond-${randomUUID()}`;

      // plant unparseable bytes where the envelope should be
      await fs.writeFile(`${directory.local.path}/${key}`, 'not-json{', {
        encoding: 'utf-8',
      });

      // conditional ops read it as logically absent
      expect(await version(key)).toEqual(undefined);
      await set(key, 'recovered', { condition: { version: null } }); // put-if-absent succeeds
      expect(await get(key)).toEqual('recovered');
    });
  });
});
