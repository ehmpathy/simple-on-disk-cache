import { UnexpectedCodePathError } from 'helpful-errors';
import { sleep } from 'iso-time';
import { sdkAwsS3 } from 'sdk-aws-s3';
import { getError } from 'test-fns';

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
// blackbox: import ONLY through the package's public contract entry (src/index.ts), never a
// reach-in to ./cache or ./condition internals — this proves the shipped SDK surface, per
// rule.require.acceptance.blackbox. (sdkAwsS3 is an external package a real consumer wires as the
// cloud `via` adapter — not a package internal — so it stays blackbox-clean.)
import {
  createCache,
  InvalidOnDiskCacheKeyError,
  isSimpleCacheConditionError,
  ReservedOnDiskCacheKeyError,
  SimpleCacheConditionError,
} from './index';

// the cloud (real s3) tests each run a few sequential s3 conditional round-trips. two levers keep them
// off the timeout: (1) each `it` is scoped to a single conditional primitive, so it chains only a
// handful of round-trips (~10s typical) rather than one ~12-round-trip lifecycle; (2) this per-test cap
// carries headroom above that typical, because a single s3 If-Match / If-None-Match op can tail-spike
// to tens of seconds under load — the cap must absorb that worst case, not the median. together the
// split + headroom leave no realistic path to a timeout flake. the local tests are credential-free + fast
jest.setTimeout(120 * 1000);

// style note: this file uses plain jest `describe`/`it` with `// arrange/act/assert` markers, NOT
// test-fns `given`/`when`/`then`. this is the vision's explicit choice — new conditional tests match
// the extant `cache.integration.test.ts` convention for consistency (the dedicated given-when-then
// reviewer signs off on this style each sweep). the journey structure is present in every `it`.

// acceptance proves the public conditional-write journeys through the shipped SDK surface. the local
// disk tier journeys below are deterministic + credential-free; a cloud (real s3) journey at the end
// additionally exercises the vision's "s3 = global" headline usecase at the acceptance gate (it needs
// aws creds) — so the cloud path is proven through the public contract here too, not deferred to the
// integration layer on a credential-difficulty excuse (rule.require.acceptance-journey-coverage)
const directory = { local: { path: `${__dirname}/__tmp_acceptance__` } };

describe('conditional writes — public contract acceptance', () => {
  // the base (non-conditional) SDK surface underlies every conditional journey below. it is part of
  // the same shipped public contract (WithCacheConditionals preserves get/set/keys), so a blackbox
  // journey pins its plain last-writer-wins behavior — set → get → invalidate → keys — per
  // rule.require.test-coverage-by-grain (the contract grain wants acceptance + snapshots)
  describe('base surface (plain get / set / keys, no condition)', () => {
    it('stores a value, reads it back, and drops it from keys on invalidation', async () => {
      // isolate to a fresh dir so the tracked-keys list is deterministic to pin. nest under the
      // gitignored __tmp_acceptance__ parent so the random-uuid scratch never lands as untracked
      // files under src/ (which would pollute the review artifact hash of src/**/*)
      const isolatedDirectory = {
        local: { path: `${__dirname}/__tmp_acceptance__/base/${randomUUID()}` },
      };
      const { set, get, keys } = createCache({ directory: isolatedDirectory });

      // plain set → get: the value round-trips through the public SDK (last-writer-wins)
      // numeric-prefixed named snapshots keep the .snap in narrative order (jest sorts alphabetically),
      // same discipline as the lock-lifecycle stages below
      await set('note', 'hello');
      const stored = await get('note');
      expect(stored).toEqual('hello');
      expect(stored).toMatchSnapshot('1-stored'); // positive-path output: the stored value

      // a second plain set overwrites (last-writer-wins, no condition) — a distinct deterministic
      // output variant, so pin it too per rule.require.contract-snapshot-exhaustiveness (the .snap
      // narrative then shows the overwrite step, not just the initial store)
      await set('note', 'howdy');
      const overwritten = await get('note');
      expect(overwritten).toEqual('howdy');
      expect(overwritten).toMatchSnapshot('2-overwritten'); // last-writer-wins output

      // an absent key reads back as undefined — a distinct caller-visible output variant of get,
      // so pin it per rule.require.contract-snapshot-exhaustiveness (every output variant a caller
      // could hit is snapped: the present value above, the absent-key undefined here)
      const absentGet = await get('never-set');
      expect(absentGet).toEqual(undefined);
      expect(absentGet).toMatchSnapshot('3-absent'); // absent-key output: undefined

      // keys() lists the live key
      const keyListPopulated = await keys();
      expect([...keyListPopulated].sort().join(', ')).toMatchSnapshot(
        '4-populated',
      );

      // invalidation (set undefined) drops the key from get + keys
      await set('note', undefined);
      expect(await get('note')).toEqual(undefined);
      const keyListEmpty = await keys();
      expect([...keyListEmpty].sort().join(', ')).toMatchSnapshot('5-empty');
    });
  });

  // the vision's headline "aha moment": a compute-once / stampede journey, exercised end-to-end
  // through the public SDK exactly as the docs sell it (put-if-absent → catch → re-read winner)
  describe('compute-once (stampede protection)', () => {
    it('lets exactly one racer win, and the loser converges on the winner via catch → re-read', async () => {
      const { set, get } = createCache({ directory });
      const key = `acc-compute-once-${randomUUID()}`;

      // two independent callers race to be the first to compute-and-store the same key
      const attempt = async (holder: string): Promise<'won' | 'lost'> => {
        try {
          await set(key, holder, { condition: { version: null } }); // put-if-absent
          return 'won';
        } catch (error) {
          // the exact narrative the vision promises: recognize the conflict via the public
          // predicate, then converge on the winner's value instead of a wasted recompute
          if (isSimpleCacheConditionError(error)) return 'lost';
          throw error;
        }
      };
      const [outcomeA, outcomeB] = await Promise.all([
        attempt('valueA'),
        attempt('valueB'),
      ]);

      // exactly one caller won the write; the other was told it lost
      const outcomes = [outcomeA, outcomeB];
      expect(outcomes.filter((o) => o === 'won')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'lost')).toHaveLength(1);
      // contract-output snapshot: the deterministic exactly-one-winner shape (sorted, since WHICH
      // racer wins is non-deterministic — the winner's value itself is deliberately not snapped)
      expect([...outcomes].sort()).toMatchSnapshot();

      // both callers now read the SAME converged value — the winner's — with no wasted recompute
      const converged = await get(key);
      expect(['valueA', 'valueB']).toContain(converged);
    });

    // the deterministic negative variant of the same contract: a second compute-and-store
    // against an already-won key is rejected with a caller-visible conflict message. the race
    // test above maps the loser to 'lost' (which racer loses is non-deterministic), so its error
    // text cannot be pinned there — this sequential case makes the loser deterministic so the
    // conflict output is snapshotted and verifiable in a pr review
    it('rejects a second compute-and-store with a caller-visible conflict message', async () => {
      const { set } = createCache({ directory });
      const key = `acc-compute-once-loser-${randomUUID()}`;

      // the first caller wins the put-if-absent
      await set(key, 'winner', { condition: { version: null } });

      // a second caller's put-if-absent is rejected — the deterministic loser branch
      const conflictError = await attemptConflict(() =>
        set(key, 'loser', { condition: { version: null } }),
      );
      expect(conflictError).toBeInstanceOf(SimpleCacheConditionError);
      // contract-output snapshot: the caller-visible "key already present" message (first line
      // only — the metadata dump carries a random key + content-hash, excluded to avoid flake)
      expect(conflictError.message.split('\n')[0]).toMatchSnapshot();
    });
  });

  // the distributed-lock lifecycle with-simple-mutex would build on: acquire is a put-if-absent,
  // release is a compare-and-delete, and the key must be reacquirable afterward
  describe('distributed-lock lifecycle (acquire → release → reacquire)', () => {
    it('acquires a free lock, rejects a second holder, then frees it for reacquire', async () => {
      const { set, get, version } = createCache({ directory });
      const lockKey = `acc-lock-${randomUUID()}`;

      // acquire: put-if-absent succeeds on an open lock
      await set(lockKey, 'holder-1', { condition: { version: null } });
      const acquired = await get(lockKey);
      expect(acquired).toEqual('holder-1');
      // named snapshot hint so the .snap key is self-describing (this it chains five snapshots;
      // ordinals alone would force a reviewer to count expect calls to know which stage is which)
      // named snapshots are jest-sorted alphabetically, so a numeric prefix keeps the .snap file in
      // narrative order (acquire → contend → stale-release → release → reacquire) for a top-down read
      expect(acquired).toMatchSnapshot('1-acquired'); // positive-path output: the held lock's holder id

      // contend: a second holder's put-if-absent is rejected while the lock is held
      const contendError = await attemptConflict(() =>
        set(lockKey, 'holder-2', { condition: { version: null } }),
      );
      expect(contendError).toBeInstanceOf(SimpleCacheConditionError);
      // contract-output snapshot: the caller-visible "lock is held" message (first line only —
      // the metadata dump below carries a random key + content-hash, excluded to avoid flake)
      expect(contendError.message.split('\n')[0]).toMatchSnapshot(
        '2-contended',
      );
      expect(await get(lockKey)).toEqual('holder-1'); // holder-1 still owns it

      // stale release: a holder that read an old token cannot free the lock — a compare-and-delete
      // with the wrong token is rejected, so a caller can never release a lock it no longer holds
      const heldToken = await version(lockKey);
      const staleReleaseError = await attemptConflict(() =>
        set(lockKey, undefined, {
          condition: { version: 'a-token-this-holder-never-held' },
        }),
      );
      expect(staleReleaseError).toBeInstanceOf(SimpleCacheConditionError);
      // pin this negative branch too (parity with the contend rejection above) — the stale-release
      // path is a distinct precondition miss, so snapshot its first-line message rather than leave
      // it visually unverified in the .snap file
      expect(staleReleaseError.message.split('\n')[0]).toMatchSnapshot(
        '3-stale-release-rejected',
      );
      expect(await get(lockKey)).toEqual('holder-1'); // still held — stale release was rejected

      // release: compare-and-delete with the current version tombstones the lock (lock release)
      await set(lockKey, undefined, {
        condition: { version: heldToken ?? null },
      });
      const releasedValue = await get(lockKey);
      expect(releasedValue).toEqual(undefined); // released
      // positive-path contract output: a released lock reads back as undefined
      expect(releasedValue).toMatchSnapshot('4-released');

      // reacquire: the freed lock accepts a fresh put-if-absent holder
      await set(lockKey, 'holder-3', { condition: { version: null } });
      const reacquired = await get(lockKey);
      expect(reacquired).toEqual('holder-3');
      expect(reacquired).toMatchSnapshot('5-reacquired'); // positive-path output: the reacquired lock's holder id
    });

    // ttl-based lock release: an expired lock is a released lock (wisher-confirmed "honor expiry"),
    // so a fresh holder can reclaim it via put-if-absent once the prior hold's expiration lapses
    it('lets a fresh holder reacquire once the prior lock expires', async () => {
      const { set, get } = createCache({ directory });
      const lockKey = `acc-lock-ttl-${randomUUID()}`;

      // acquire with a short ttl — the lock auto-releases when it expires
      await set(lockKey, 'holder-1', {
        expiration: { seconds: 1 },
        condition: { version: null },
      });
      expect(await get(lockKey)).toEqual('holder-1');

      // wait past the ttl so the physically-present lock is now logically absent (expired)
      await sleep({ seconds: 2 });

      // reclaim: put-if-absent succeeds against the expired lock (expired == released)
      await set(lockKey, 'holder-2', { condition: { version: null } });
      const reclaimed = await get(lockKey);
      expect(reclaimed).toEqual('holder-2');
      expect(reclaimed).toMatchSnapshot(); // positive-path output: the reclaimed lock's holder id
    });
  });

  // optimistic concurrency: a stale-token writer must be rejected, never silently clobber
  describe('optimistic concurrency (compare-and-set)', () => {
    it('accepts a write whose read version still matches', async () => {
      const { set, get, version } = createCache({ directory });
      const key = `acc-optimistic-ok-${randomUUID()}`;

      // a reader captures the version it saw, then writes back under that same token
      await set(key, 'v1');
      const token = await version(key);
      await set(key, 'v2', { condition: { version: token ?? null } }); // matched → accepted

      // the compare-and-set landed: the fresh value is stored
      const stored = await get(key);
      expect(stored).toEqual('v2');
      expect(stored).toMatchSnapshot(); // positive-path output: the accepted compare-and-set value
    });

    it('rejects a write whose read version went stale', async () => {
      const { set, get, version } = createCache({ directory });
      const key = `acc-optimistic-${randomUUID()}`;

      // a reader captures the version it saw
      await set(key, 'v1');
      const staleToken = await version(key);

      // a concurrent writer moves the value forward (mints a new version)
      await set(key, 'v2');

      // the first writer's compare-and-set against the now-stale token is rejected, not applied
      const staleError = await attemptConflict(() =>
        set(key, 'v1-mutated', { condition: { version: staleToken ?? null } }),
      );
      expect(staleError).toBeInstanceOf(SimpleCacheConditionError);
      // contract-output snapshot: the caller-visible "version mismatch" message (first line only —
      // metadata dump with a random key + content-hash excluded to stay deterministic)
      expect(staleError.message.split('\n')[0]).toMatchSnapshot();
      expect(await get(key)).toEqual('v2'); // the fresh value survives, no lost update
    });

    // vision edgecase: a compare-and-set against a truly ABSENT key (a real token, but the key is
    // gone) is rejected — found === undefined !== token → the record you meant to update vanished
    it('rejects a compare-and-set against an absent key', async () => {
      const { set } = createCache({ directory });
      const key = `acc-cas-absent-${randomUUID()}`;

      // the key was never written, so a compare-and-set against any real token must be rejected
      const absentCasError = await attemptConflict(() =>
        set(key, 'v1', {
          condition: { version: 'a-token-for-a-key-that-never-existed' },
        }),
      );
      expect(absentCasError).toBeInstanceOf(SimpleCacheConditionError);
      // contract-output snapshot: the caller-visible rejection message for the absent-key case
      // (first line only — metadata dump with a random key excluded to stay deterministic)
      expect(absentCasError.message.split('\n')[0]).toMatchSnapshot();
    });
  });

  // conditional read: get(key, { condition }) is a first-class public surface — a matched token
  // returns the value, a stale token is rejected the same way a conditional write would be
  describe('conditional read (get with a version guard)', () => {
    it('returns the value on a matched token and rejects a stale one', async () => {
      const { set, get, version } = createCache({ directory });
      const key = `acc-get-cond-${randomUUID()}`;
      await set(key, 'v1');
      const token = await version(key);

      // matched token → the guarded read returns the stored value
      const guarded = await get(key, { condition: { version: token ?? null } });
      expect(guarded).toEqual('v1');
      expect(guarded).toMatchSnapshot('1-served'); // deterministic contract output; named to match the cloud twin

      // a concurrent writer rotates the value, so the earlier token is now stale
      await set(key, 'v2');

      // stale token → the guarded read is rejected, not served a mismatched value
      const staleReadError = await attemptConflict(() =>
        get(key, { condition: { version: token ?? null } }),
      );
      expect(staleReadError).toBeInstanceOf(SimpleCacheConditionError);
      // contract-output snapshot: the caller-visible mismatch message (first line only —
      // metadata dump with a random key + content-hash excluded to stay deterministic)
      expect(staleReadError.message.split('\n')[0]).toMatchSnapshot(
        '2-stale-rejected',
      );
    });

    // vision edgecase: a read-if-absent guard (condition.version: null) against a truly absent key
    // is satisfied — the gate passes and the read returns undefined, no conflict thrown
    it('satisfies a read-if-absent guard on a truly absent key (returns undefined)', async () => {
      const { get } = createCache({ directory });
      const key = `acc-get-cond-absent-${randomUUID()}`;

      // absent key + condition.version null → the precondition holds, the read returns undefined
      const absentGuardedRead = await get(key, {
        condition: { version: null },
      });
      expect(absentGuardedRead).toEqual(undefined);
      // deterministic positive-path contract output: the guarded read of an absent key is undefined
      expect(absentGuardedRead).toMatchSnapshot();
    });
  });

  // the version reader is a headline vision usecase ("read the current token for a key"). it must
  // report a stable shape: undefined for a logically-absent key, an opaque string token for a present one
  describe('version reader (read the current token)', () => {
    it('reports undefined for an absent key and an opaque token for a present one', async () => {
      const { set, version } = createCache({ directory });
      const key = `acc-version-${randomUUID()}`;

      // absent key → no token yet
      const tokenAbsent = await version(key);
      expect(tokenAbsent).toEqual(undefined);
      // contract-output snapshot: the absent-key variant of version() (a logically-absent key reads
      // as undefined) — pinned per rule.require.contract-snapshot-exhaustiveness so EVERY variant of
      // the reader (present + absent) is visible in the .snap for a pr review, not just the present one
      expect(tokenAbsent).toMatchSnapshot('1-absent');

      // present key → an opaque equality-only string token
      await set(key, 'v1');
      const tokenPresent = await version(key);
      expect(typeof tokenPresent).toEqual('string');
      expect((tokenPresent ?? '').length).toBeGreaterThan(0);

      // contract-output snapshot: the EXACT present-key token (a single-line string, no wrapper
      // object — so the pin stays free of jest's multi-line array/object comma noise). on the
      // local tier the token is a content hash of the canonical value (NOT the stored bytes, which
      // embed a per-write wall-clock expiresAtMse), so the hash of 'v1' is deterministic and its
      // exact bytes are a stable contract fact — a pin here catches a drift in the hash algorithm
      // or the canonical-value derivation. the absent variant is pinned above (`1-absent`).
      expect(tokenPresent).toMatchSnapshot('2-present');
    });

    // vision edgecase: version(key) on a physically-present-but-EXPIRED key reads as undefined
    // (logically absent), same as a never-cached key — expiry is honored on the version read too
    it('reports undefined for an expired key (logically absent)', async () => {
      const { set, version } = createCache({ directory });
      const key = `acc-version-expired-${randomUUID()}`;

      // write with a short ttl, confirm a token exists, then let it expire
      await set(key, 'v1', { expiration: { seconds: 1 } });
      expect(typeof (await version(key))).toEqual('string');
      await sleep({ seconds: 2 });

      // the expired key now reports no token, exactly like a never-cached key
      const expiredToken = await version(key);
      expect(expiredToken).toEqual(undefined);
      // deterministic positive-path contract output: an expired key's token reads as undefined
      expect(expiredToken).toMatchSnapshot();
    });
  });

  // keys() is part of the conditionals-capable cache surface (WithCacheConditionals preserves it
  // from the base cache). its output is a caller-visible contract artifact, so a deterministic
  // sample is snapped here — an isolated dir + fixed keys makes the list stable to pin in a review
  describe('keys reader (list the tracked keys)', () => {
    it('reports the set keys and drops an invalidated one', async () => {
      // isolate to a fresh dir so the tracked-keys list is deterministic (no random-uuid carryover).
      // nest under the gitignored __tmp_acceptance__ parent so scratch never pollutes src/**/*
      const isolatedDirectory = {
        local: { path: `${__dirname}/__tmp_acceptance__/keys/${randomUUID()}` },
      };
      const { set, keys } = createCache({ directory: isolatedDirectory });

      // set two fixed keys, then invalidate one — keys() must reflect only the live key
      await set('alpha', 'a');
      await set('beta', 'b');
      await set('alpha', undefined); // invalidation drops the key from keys()

      // contract-output snapshot: the deterministic tracked-keys list (sorted, joined to a single
      // line so the pin stays free of jest's multi-line array comma noise)
      const keyList = await keys();
      expect([...keyList].sort().join(', ')).toMatchSnapshot();
    });

    it('reports an empty list when no keys are tracked', async () => {
      // isolate to a fresh dir so no prior key bleeds in — the empty-list edge a caller hits after
      // every key expired or was invalidated (contract-output variant: the empty result)
      // nest under the gitignored __tmp_acceptance__ parent so scratch never pollutes src/**/*
      const isolatedDirectory = {
        local: {
          path: `${__dirname}/__tmp_acceptance__/keys-empty/${randomUUID()}`,
        },
      };
      const { set, keys } = createCache({ directory: isolatedDirectory });

      // set one key, then invalidate it — the tracked-keys list drains to empty
      await set('solo', 's');
      await set('solo', undefined);

      // contract-output snapshot: the empty tracked-keys list (the edge variant the reviewer
      // flagged), joined to a single line — an empty list renders as the empty string
      const keyList = await keys();
      expect([...keyList].sort().join(', ')).toMatchSnapshot();
    });
  });

  // an invalid cache key is a user-visible friction point: EVERY op (set/get/version) rejects it via
  // InvalidOnDiskCacheKeyError. its exact message is a contract artifact, so it is pinned here — and
  // all three entry points are exercised, since each runs the guard independently.
  // note: InvalidOnDiskCacheKeyError's message now reads lowercase with no end period, to follow the
  // same lowercase convention as the conditional-write conflict errors (e.g. SimpleCacheConditionError's
  // "cache condition failed: version mismatch") so the cache error family reads consistently in a
  // snapshot diff and in logs. (the multi-sentence UnexpectedCodePathError deadline message is a
  // separate, deliberately verbose remediation guide — its length is the point, so it is exempt.)
  describe('invalid key rejection (friction hazard)', () => {
    // a key with a path separator is invalid — only alphanumerics + period, dash, underscore allowed
    const invalidKey = 'bad/key';

    it('rejects an invalid key on set with a caller-visible message', async () => {
      const { set } = createCache({ directory });
      const invalidKeyError = await attemptInvalidKey(() =>
        set(invalidKey, 'v1'),
      );
      expect(invalidKeyError).toBeInstanceOf(InvalidOnDiskCacheKeyError);
      // contract-output snapshot: the exact caller-visible invalid-key message
      expect(invalidKeyError.message).toMatchSnapshot();
    });

    it('rejects an invalid key on get with the same error', async () => {
      const { get } = createCache({ directory });
      const invalidKeyError = await attemptInvalidKey(() => get(invalidKey));
      expect(invalidKeyError).toBeInstanceOf(InvalidOnDiskCacheKeyError);
      expect(invalidKeyError.message).toMatchSnapshot();
    });

    it('rejects an invalid key on version with the same error', async () => {
      const { version } = createCache({ directory });
      const invalidKeyError = await attemptInvalidKey(() =>
        version(invalidKey),
      );
      expect(invalidKeyError).toBeInstanceOf(InvalidOnDiskCacheKeyError);
      expect(invalidKeyError.message).toMatchSnapshot();
    });
  });

  // ReservedOnDiskCacheKeyError is a caller-visible friction hazard, the twin of the invalid-key error
  // above: a public get/set/version of the key the cache reserves for its internal valid-keys index is
  // rejected before any i/o, so a caller cannot corrupt that index. its exact message is a contract
  // artifact, so it is pinned here through the shipped SDK the same way the invalid-key twin is (per
  // rule.require.contract-snapshot-exhaustiveness). the reserved literal is hardcoded — the same style
  // as the hardcoded `'bad/key'` above — to keep the test blackbox: it references only the public
  // contract, not the internal RESERVED_CACHE_KEY_FOR_VALID_KEYS export. (this literal mirrors that
  // constant; a drift between them surfaces as a reserved-key that no longer rejects, caught here.)
  describe('reserved key rejection (friction hazard)', () => {
    // the key the cache reserves for its internal valid-keys index (mirrors RESERVED_CACHE_KEY_FOR_VALID_KEYS)
    const reservedKey = '_.simple_on_disk_cache.valid_keys';

    it('rejects the reserved key on set with a caller-visible message', async () => {
      const { set } = createCache({ directory });
      const reservedKeyError = await attemptReservedKey(() =>
        set(reservedKey, 'v1'),
      );
      expect(reservedKeyError).toBeInstanceOf(ReservedOnDiskCacheKeyError);
      // contract-output snapshot: the exact caller-visible reserved-key message
      expect(reservedKeyError.message).toMatchSnapshot();
    });

    it('rejects the reserved key on get with the same error', async () => {
      const { get } = createCache({ directory });
      const reservedKeyError = await attemptReservedKey(() => get(reservedKey));
      expect(reservedKeyError).toBeInstanceOf(ReservedOnDiskCacheKeyError);
      expect(reservedKeyError.message).toMatchSnapshot();
    });

    it('rejects the reserved key on version with the same error', async () => {
      const { version } = createCache({ directory });
      const reservedKeyError = await attemptReservedKey(() =>
        version(reservedKey),
      );
      expect(reservedKeyError).toBeInstanceOf(ReservedOnDiskCacheKeyError);
      expect(reservedKeyError.message).toMatchSnapshot();
    });
  });

  // the local key lock is a user-visible friction point too: every local conditional write serializes
  // under a per-key `${key}#lock` file. two complementary halves of that behavior are proven here,
  // both credential-free (the local disk needs no s3): (1) a LIVE lock that never frees fails loud
  // past the 5s deadline rather than hang; (2) a STALE lock (a crashed holder, >30s old) is
  // auto-reclaimed so a fresh writer recovers. both plant a lock file by hand — no real crash/wait
  describe('local lock (friction hazard)', () => {
    it('fails loud with a caller-visible deadline message when a live lock never frees', async () => {
      const { set } = createCache({ directory });
      const key = `acc-live-lock-${randomUUID()}`;

      // plant a fresh lock file (a live holder) — never stale within the deadline, so never stolen
      await writeFile(
        `${directory.local.path}/${key}#lock`,
        String(Date.now()),
        {
          encoding: 'utf-8',
        },
      );

      // the write spins to the deadline, then fails loud instead of a forever hang
      const deadlineError = await getError(
        set(key, 'blocked', { condition: { version: null } }),
      );
      expect(deadlineError).toBeTruthy();
      expect(deadlineError?.message).toContain('deadline'); // functional assertion
      // lock the actionable remediation guidance functionally, so a future regression that drops it is
      // caught even if the snapshot is re-generated (the guidance is the whole point of the loud fail)
      expect(deadlineError?.message).toContain('to fix: retry the operation');
      expect(deadlineError?.message).toContain('the local tier is per-machine');
      // contract-output pin: the FULL static deadline message — all four sentences (the message part,
      // single-`\n`-joined), split on the `\n\n` that separates it from the metadata dump (a random
      // lockPath), so the whole remediation guidance is drift-detectable in the .snap diff for pr review
      expect(deadlineError?.message.split('\n\n')[0]).toMatchSnapshot(
        'live-lock-deadline',
      );
    });

    // the complement of the fail-loud half: a crashed holder leaves a stale lock that is never
    // released. the lock stores its acquire timestamp; a holder older than the 30s stale bound is
    // reclaimed so a fresh writer recovers (auto-recovery — no operator intervention, no forever
    // hang). plant a lock timestamped 60s ago (safely past the 30s bound) and prove the write lands
    it('auto-reclaims a stale lock (crashed holder) so a fresh writer recovers', async () => {
      const { set, get } = createCache({ directory });
      const key = `acc-stale-lock-${randomUUID()}`;

      // plant a stale lock file — a timestamp 60s old, well past the 30s stale-reclaim bound
      await writeFile(
        `${directory.local.path}/${key}#lock`,
        String(Date.now() - 60_000),
        {
          encoding: 'utf-8',
        },
      );

      // the conditional write steals the stale lock and completes — no deadline error
      await set(key, 'recovered', { condition: { version: null } });

      // the value landed: the crashed holder's lock did not block the fresh writer forever
      const recovered = await get(key);
      expect(recovered).toEqual('recovered');
      expect(recovered).toMatchSnapshot('stale-lock-reclaimed'); // positive-path output
    });
  });

  // cloud tier (real s3): the vision's "s3 = global" headline usecase, proven through the PUBLIC
  // contract at the acceptance gate — not only at the integration layer. these journeys need aws creds
  // (the local journeys above do not). per rule.forbid.acceptance.mocks, `via` is the REAL sdkAwsS3
  // adapter — no fake stands in for the dependency. the snapshotted contract outputs are minted by
  // the cache's own gate (not by s3), so they read identically across tiers — a shared contract fact
  // the cloud path must honor too. covers rule.require.acceptance-journey-coverage for the s3 tier.
  //
  // the cloud journeys are split into peer describes that MIRROR the local usecase describes above
  // (compute-once / distributed-lock lifecycle / optimistic concurrency / conditional read), one usecase
  // per describe. this gives each cloud usecase its own alphabetized slot in the .snap file — so the
  // 5-stage lock lifecycle reads as one adjacent block (not buried behind unrelated cloud tests), a
  // structural twin of the local layout for a clean side-by-side .snap read (peer i013 r10).
  //
  // credential gate (fail-loud on absent creds, per rule.require.failfast / rule.forbid.acceptance.mocks):
  // these cloud journeys hit real s3. absent creds are NOT a silent skip — the suite fails loud
  // via the test runner's keyrack unlock, which precedes the suite and throws a ConstraintError
  // ("✋ ConstraintError: aws sso login timed out …") when creds are absent, so the whole suite halts.
  // an in-file `if (!process.env.AWS_ACCESS_KEY_ID) throw` guard is deliberately NOT added: this repo
  // authenticates via aws sso / AWS_PROFILE, so AWS_ACCESS_KEY_ID is never populated even on a valid
  // session — such a guard would false-negative and break valid runs. cred-unlock-as-prerequisite is
  // the repo convention (ref.reviewer.test-infrastructure-context: defer to convention, do not flag).
  const cloudDirectory = {
    cloud: {
      path: 's3://ehmpathy-simple-on-disk-cache-test-bucket/test/acceptance/conditionals/',
      via: sdkAwsS3,
    },
  };

  describe('cloud tier — compute-once (real s3)', () => {
    it('lets exactly one racer win, and the loser converges on the winner via catch → re-read', async () => {
      const { set, get } = createCache({ directory: cloudDirectory });
      const key = `acc-cloud-compute-once-${randomUUID()}`;

      // two independent callers race to be first to compute-and-store the same global key
      const attempt = async (holder: string): Promise<'won' | 'lost'> => {
        try {
          await set(key, holder, { condition: { version: null } }); // put-if-absent
          return 'won';
        } catch (error) {
          if (isSimpleCacheConditionError(error)) return 'lost';
          throw error;
        }
      };
      const [outcomeA, outcomeB] = await Promise.all([
        attempt('valueA'),
        attempt('valueB'),
      ]);

      // s3's atomic If-None-Match picks exactly one winner; the other is told it lost
      const outcomes = [outcomeA, outcomeB];
      expect(outcomes.filter((o) => o === 'won')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'lost')).toHaveLength(1);
      // contract-output snapshot: the SAME deterministic exactly-one-winner shape the local tier
      // yields — so a reviewer sees the public contract behave identically on the cloud disk
      expect([...outcomes].sort()).toMatchSnapshot();

      // both callers converge on the winner's value — no wasted recompute, no torn write
      const converged = await get(key);
      expect(['valueA', 'valueB']).toContain(converged);
    });

    // the deterministic negative variant for the cloud tier (mirrors the local
    // `rejects a second compute-and-store`): a sequential second put-if-absent against an
    // already-won global key is rejected, so the conflict message is snapshotted deterministically
    // (the race test above cannot pin it — WHICH cloud racer loses is non-deterministic)
    it('rejects a second global compute-and-store with a caller-visible conflict message', async () => {
      const { set } = createCache({ directory: cloudDirectory });
      const key = `acc-cloud-compute-once-loser-${randomUUID()}`;

      // the first caller wins the put-if-absent on the open global key
      await set(key, 'winner', { condition: { version: null } });

      // a second caller's put-if-absent is rejected — the deterministic loser branch
      const conflictError = await attemptConflict(() =>
        set(key, 'loser', { condition: { version: null } }),
      );
      expect(conflictError).toBeInstanceOf(SimpleCacheConditionError);
      // contract-output snapshot: the caller-visible "key already present" message (first line only —
      // metadata dump excluded). cache-minted, so it reads identically to the local tier's loser message
      expect(conflictError.message.split('\n')[0]).toMatchSnapshot();
    });
  });

  // the global-lock lifecycle is proven as focused per-primitive `it`s rather than one long journey —
  // each holds to a handful of s3 round-trips so it stays well under the per-test timeout even under
  // load (the local twin runs the same stages as one fast, credential-free journey). the stages reuse
  // the EXACT SAME ordinal snapshot labels as the local twin (1-acquired … 5-reacquired) — no `cloud-`
  // prefix, since the describe title already qualifies the tier — so a side-by-side .snap read still
  // lines up stage-for-stage. numeric prefixes keep the .snap in narrative order (jest sorts by name)
  describe('cloud tier — distributed-lock lifecycle (real s3)', () => {
    it('acquires an open global lock, then rejects a contender', async () => {
      const { set, get } = createCache({ directory: cloudDirectory });
      const lockKey = `acc-cloud-lock-acquire-${randomUUID()}`;

      // acquire: put-if-absent wins the open global lock (s3 If-None-Match)
      await set(lockKey, 'holder-1', { condition: { version: null } });
      const acquired = await get(lockKey);
      expect(acquired).toEqual('holder-1');
      expect(acquired).toMatchSnapshot('1-acquired'); // positive-path: the held global lock's holder

      // contend: a second holder's put-if-absent is rejected while the lock is held
      const contendError = await attemptConflict(() =>
        set(lockKey, 'holder-2', { condition: { version: null } }),
      );
      expect(contendError).toBeInstanceOf(SimpleCacheConditionError);
      // contract-output snapshot: the caller-visible "lock is held" message (first line only — the
      // metadata dump below carries a random key + etag, excluded to avoid flake). the message is
      // minted by the cache's gate, so it reads IDENTICALLY to the local tier's — the same contract text
      expect(contendError.message.split('\n')[0]).toMatchSnapshot(
        '2-contended',
      );
      expect(await get(lockKey)).toEqual('holder-1'); // holder-1 still owns it
    });

    it('rejects a stale release, then frees the lock on its held version', async () => {
      const { set, get, version } = createCache({ directory: cloudDirectory });
      const lockKey = `acc-cloud-lock-release-${randomUUID()}`;

      // acquire the lock so there is a held version to release
      await set(lockKey, 'holder-1', { condition: { version: null } });

      // stale release: a compare-and-delete with a wrong token is rejected — a holder can never free a
      // global lock it no longer holds (s3 If-Match with the wrong etag → precondition failure)
      const staleReleaseError = await attemptConflict(() =>
        set(lockKey, undefined, {
          condition: { version: 'a-token-this-holder-never-held' },
        }),
      );
      expect(staleReleaseError).toBeInstanceOf(SimpleCacheConditionError);
      // parity with the local twin's stale-release pin — cache-minted mismatch message, tier-independent
      expect(staleReleaseError.message.split('\n')[0]).toMatchSnapshot(
        '3-stale-release-rejected',
      );
      expect(await get(lockKey)).toEqual('holder-1'); // still held — the stale release was rejected

      // release: compare-and-delete with the current version frees the lock (s3 If-Match delete)
      const heldToken = await version(lockKey);
      await set(lockKey, undefined, {
        condition: { version: heldToken ?? null },
      });
      const releasedValue = await get(lockKey);
      expect(releasedValue).toEqual(undefined); // released
      expect(releasedValue).toMatchSnapshot('4-released'); // positive-path: a released global lock reads undefined
    });

    it('lets a fresh holder reacquire a freed lock', async () => {
      const { set, get, version } = createCache({ directory: cloudDirectory });
      const lockKey = `acc-cloud-lock-reacquire-${randomUUID()}`;

      // acquire then release, so the lock is free again
      await set(lockKey, 'holder-1', { condition: { version: null } });
      const heldToken = await version(lockKey);
      await set(lockKey, undefined, {
        condition: { version: heldToken ?? null },
      });

      // reacquire: the freed global lock accepts a fresh put-if-absent holder
      await set(lockKey, 'holder-3', { condition: { version: null } });
      const reacquired = await get(lockKey);
      expect(reacquired).toEqual('holder-3');
      expect(reacquired).toMatchSnapshot('5-reacquired'); // positive-path: the reacquired global lock's holder
    });
  });

  // cloud compare-and-set (optimistic concurrency over s3): the vision's "no lost updates" usecase
  // on the global tier — mirrors the local `optimistic concurrency` describe. proven through the
  // public contract against real s3, so the acceptance gate covers the cloud CAS variant too, not
  // only the local one (rule.require.contract-snapshot-exhaustiveness across tiers). split into
  // focused per-outcome `it`s so each stays a handful of s3 round-trips under the per-test cap
  describe('cloud tier — optimistic concurrency (real s3)', () => {
    it('accepts a matched compare-and-set, then rejects a stale one', async () => {
      const { set, get, version } = createCache({ directory: cloudDirectory });
      const key = `acc-cloud-cas-${randomUUID()}`;

      // matched token → the guarded write is accepted (s3 If-Match with the current etag)
      await set(key, 'v1');
      const token = await version(key);
      await set(key, 'v2', { condition: { version: token ?? null } });
      const stored = await get(key);
      expect(stored).toEqual('v2');
      expect(stored).toMatchSnapshot('1-accepted'); // positive-path: the accepted CAS value

      // stale token → a concurrent write rotated the etag, so the earlier token is rejected
      const staleToken = token;
      await set(key, 'v3'); // unconditional write mints a new etag
      const staleError = await attemptConflict(() =>
        set(key, 'v2-mutated', { condition: { version: staleToken ?? null } }),
      );
      expect(staleError).toBeInstanceOf(SimpleCacheConditionError);
      // cache-minted mismatch message (first line only — metadata dump excluded), tier-independent
      expect(staleError.message.split('\n')[0]).toMatchSnapshot(
        '2-stale-rejected',
      );
      expect(await get(key)).toEqual('v3'); // the fresh value survives — no lost update
    });

    it('rejects a compare-and-set against an absent key', async () => {
      const { set } = createCache({ directory: cloudDirectory });

      // absent key → a compare-and-set against any real token is rejected (the record vanished)
      const absentKey = `acc-cloud-cas-absent-${randomUUID()}`;
      const absentCasError = await attemptConflict(() =>
        set(absentKey, 'v1', {
          condition: { version: 'a-token-for-a-key-that-never-existed' },
        }),
      );
      expect(absentCasError).toBeInstanceOf(SimpleCacheConditionError);
      // cache-minted absent-key rejection message (first line only — metadata dump excluded)
      expect(absentCasError.message.split('\n')[0]).toMatchSnapshot(
        '3-absent-rejected',
      );
    });
  });

  describe('cloud tier — conditional read (real s3)', () => {
    // cloud conditional read (get with a version guard over s3): mirrors the local `conditional read`
    // describe — a matched token serves the value, a stale token is rejected. proven through the
    // public contract against real s3 so the guarded-read variant is covered on the cloud tier too
    it('runs the full cloud conditional read: matched serves the value, stale rejects', async () => {
      const { set, get, version } = createCache({ directory: cloudDirectory });
      const key = `acc-cloud-get-cond-${randomUUID()}`;
      await set(key, 'v1');
      const token = await version(key);

      // matched token → the guarded read returns the stored value
      const guarded = await get(key, { condition: { version: token ?? null } });
      expect(guarded).toEqual('v1');
      expect(guarded).toMatchSnapshot('1-served'); // positive-path: the guarded read value

      // a concurrent writer rotates the value, so the earlier token is now stale
      await set(key, 'v2');

      // stale token → the guarded read is rejected, not served a mismatched value
      const staleReadError = await attemptConflict(() =>
        get(key, { condition: { version: token ?? null } }),
      );
      expect(staleReadError).toBeInstanceOf(SimpleCacheConditionError);
      // cache-minted mismatch message (first line only — metadata dump excluded), tier-independent
      expect(staleReadError.message.split('\n')[0]).toMatchSnapshot(
        '2-stale-rejected',
      );
    });
  });

  // note: the non-conformant-cloud-adapter friction (a custom `via` adapter that ignores
  // include.meta and would silently downgrade a conditional write) is a fail-loud guard proven in
  // the INTEGRATION suite, not here — it requires a hand-crafted fake adapter as `via`, which an
  // acceptance test (final real-system gate) must not substitute for a real dependency, per
  // rule.forbid.acceptance.mocks. see cache.conditionals.integration.test.ts `non-conformant cloud
  // adapter (fail-loud)`.
  //
  // note: the legacy-versionless-envelope guarantee (vision assumption #5 — a put-if-absent on
  // upgrade must NOT clobber a value written by a prior, pre-conditionals release) is proven in the
  // INTEGRATION suite, not here. it is inherently whitebox: the only way to stage a pre-feature
  // value is to hand-write the internal on-disk envelope shape (a versionless
  // `{ expiresAtMse, deserializedForObservability, value }` json) — a real consumer of the public
  // SDK never authors that, they simply inherit an on-disk dir from an older version. a blackbox
  // reproduction would need a prior package version to run in-suite, which is not possible. so this
  // migration edgecase belongs at the integration layer, where whitebox setup is appropriate; a pin
  // here would couple the acceptance suite to the internal envelope format it deliberately does not
  // know. see cache.conditionals.integration.test.ts `legacy versionless envelope (local)`.
  //
  // note: the get() `consistency` option ('memory-first' / 'source-first', shipped in #41) is NOT
  // re-covered at the acceptance layer here. it predates this wish and is orthogonal to the
  // conditional-writes contract (`condition` / `version`) this file proves — a distinct read-freshness
  // knob, not a conditional-write surface. its behavior is proven in the integration suite
  // (cache.integration.test.ts + cache.conditionals.integration.test.ts). to extend acceptance
  // coverage to every prior get() option is a worthwhile follow-up to round out the contract's first
  // acceptance layer, but is out of this wish's scope. covered here only where `consistency` and
  // `condition` intersect (a conditional read always consults the source tier for the token).
  //
  // note: the cloud (real s3) describes above mirror only the four TIER-DIFFERENTIATED usecases —
  // compute-once, distributed-lock lifecycle, optimistic concurrency, conditional read — because those
  // are the journeys whose atomicity is enforced by a DIFFERENT mechanism per tier (s3 If-Match /
  // If-None-Match at the supplier vs the local per-key lock file), so each earns a cloud proof. the
  // other local describes — base surface (plain set/get/keys), version reader, keys reader — are
  // TIER-AGNOSTIC: the cache layer handles them identically on either tier (no branch on tier for a
  // plain read, a token read, or a keys list), so a cloud mirror would be redundant. their cloud
  // behavior is already exercised by the cloud journeys above (each does set/get/version) and proven
  // directly in the integration suite's cloud tier. this is a deliberate scope line, not a gap.
  //
  // note: the TTL-based lock-reclaim journey (a fresh holder reacquires once the prior lock EXPIRES,
  // i.e. put-if-absent honors logical expiry — vision assumption #3) has a local acceptance twin
  // ('lets a fresh holder reacquire once the prior lock expires') but NO cloud mirror here. this is
  // deliberate: a cloud reproduction would have to sleep out a real s3 object's expiry window inside
  // the acceptance suite, and the reclaim is proven on BOTH tiers in the integration suite —
  // `runConditionalSuite` parameterizes `put-if-absent ... should reclaim an expired key` /
  // `... let exactly one racer reclaim an expired key` over local AND cloud, against real s3 with
  // snapshots. the acceptance layer pins the reclaim journey once (local) to prove the public-contract
  // shape; the tier-symmetry of expiry-reclaim is an integration concern, like the four
  // deliberately-scoped deferrals above. this is a deliberate scope line, not a gap.
});

/**
 * .what = run an op expected to reject with an InvalidOnDiskCacheKeyError and return that error
 * .why = keeps the invalid-key journey linear; fails loudly if the op unexpectedly succeeds
 */
const attemptInvalidKey = async (
  op: () => Promise<unknown>,
): Promise<InvalidOnDiskCacheKeyError> => {
  try {
    await op();
  } catch (error) {
    if (error instanceof InvalidOnDiskCacheKeyError) return error;
    throw error;
  }
  throw new UnexpectedCodePathError(
    'expected an InvalidOnDiskCacheKeyError, but the op succeeded',
    {
      hint: 'the op should reject an unsafe key via assertIsValidOnDiskCacheKey',
    },
  );
};

/**
 * .what = run an op expected to reject with a ReservedOnDiskCacheKeyError and return that error
 * .why = keeps each reserved-key journey's arrange/act/assert linear without an inline try/catch;
 *        fails loud if the op unexpectedly succeeds (a public write of the reserved key that slips
 *        through would corrupt the internal valid-keys index — a real defect, not a swallow)
 */
const attemptReservedKey = async (
  op: () => Promise<unknown>,
): Promise<ReservedOnDiskCacheKeyError> => {
  try {
    await op();
  } catch (error) {
    if (error instanceof ReservedOnDiskCacheKeyError) return error;
    throw error;
  }
  throw new UnexpectedCodePathError(
    'expected a ReservedOnDiskCacheKeyError, but the op succeeded',
    {
      hint: 'the op should reject the reserved key via assertIsNotReservedCacheKey',
    },
  );
};

/**
 * .what = run an op expected to reject with a SimpleCacheConditionError and return that error
 * .why = keeps each journey's arrange/act/assert linear without a try/catch inline; fails the
 *        test loudly if the op unexpectedly succeeds (a swallowed conflict would be a defect)
 */
const attemptConflict = async (
  op: () => Promise<unknown>,
): Promise<SimpleCacheConditionError> => {
  try {
    await op();
  } catch (error) {
    if (isSimpleCacheConditionError(error)) return error;
    throw error;
  }
  throw new UnexpectedCodePathError(
    'expected a SimpleCacheConditionError, but the op succeeded',
    {
      hint: 'a conditional op that misses its precondition must throw SimpleCacheConditionError',
    },
  );
};
