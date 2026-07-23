import { promises as fs } from 'fs';
import { type IsoDuration, sleep, toMilliseconds } from 'iso-time';
import { sdkAwsS3 } from 'sdk-aws-s3';

import { RESERVED_CACHE_KEY_FOR_VALID_KEYS } from './domain.objects/RESERVED_CACHE_KEY_FOR_VALID_KEYS';
import { createCache } from './domain.operations/createCache';

/**
 * create a timer that tracks time left until target
 *
 * .why = ensures we check at exact times from TTL start, regardless of S3 latency
 */
const genTimer = (input: { for: IsoDuration }) => {
  const startedAtMse = Date.now();
  const targetMse = startedAtMse + toMilliseconds(input.for);
  return {
    get: () => ({
      left: { milliseconds: Math.max(0, targetMse - Date.now()) },
    }),
  };
};

jest.setTimeout(60 * 1000);

describe('cache', () => {
  describe('local', () => {
    const directoryToPersistTo = { local: { path: `${__dirname}/__tmp__` } };
    it('should round-trip an empty-string value on a memory-first cache', async () => {
      // regression: an empty string is a legitimate cached value, distinct from undefined (a
      // tombstone). the memory-first read path once used truthy guards that misread '' as a miss →
      // it returned undefined instead of the stored ''. this proves '' survives the memory tier.
      const { set, get } = createCache({
        directory: directoryToPersistTo,
        consistency: 'memory-first',
      });
      const key = `empty-string-memory-first-${Date.now()}`;

      // store an empty string, then read it back through the memory-first path
      await set(key, '');
      const valueFound = await get(key);

      // the empty string must survive — not collapse to undefined
      expect(valueFound).toEqual('');
    });
    it('should be able to add an item to the cache', async () => {
      const { set } = createCache({ directory: directoryToPersistTo });
      await set('meaning-of-life', '42');
    });
    it('should be able to get an item from the cache', async () => {
      const { set, get } = createCache({ directory: directoryToPersistTo });
      await set(
        'how-many-licks-does-it-take-to-get-to-the-center-of-a-tootsie-pop',
        '3',
      );
      const licks = await get(
        'how-many-licks-does-it-take-to-get-to-the-center-of-a-tootsie-pop',
      );
      expect(licks).toEqual('3');
    });
    it('should respect the default expiration for the cache', async () => {
      const { set, get } = createCache({
        directory: directoryToPersistTo,
        expiration: { seconds: 10 },
      }); // we're gonna use this cache to keep track of the popcorn in the microwave - we should check more regularly since it changes quickly!

      // create timers before set() so each checkpoint tracks from an absolute TTL start, not from
      // set() return (the genTimer pattern — no relative-sleep drift accumulates across checkpoints).
      // note: WIDE 5s margins on BOTH sides of the 10s ttl boundary, so even a multi-second single
      //       sleep overshoot under concurrent-suite + real-s3 load can never straddle the expiry —
      //       the pre-expiry check fires at 5s (5s before) and the post-expiry check at 15s (5s after)
      const timer5s = genTimer({ for: { seconds: 5 } });
      const timer15s = genTimer({ for: { seconds: 15 } });
      await set('how-popped-is-the-popcorn', 'not popped');

      // prove that we recorded the value and its accessible immediately after set
      const popcornStatus = await get('how-popped-is-the-popcorn');
      expect(popcornStatus).toEqual('not popped');

      // prove that the value is still accessible at 5s from TTL start (a wide 5s margin before expiry)
      await sleep(timer5s.get().left.milliseconds);
      const popcornStatusBeforeExpiry = await get('how-popped-is-the-popcorn');
      expect(popcornStatusBeforeExpiry).toEqual('not popped'); // still should say not popped

      // and prove that well after the 10s ttl (at 15s from TTL start, a 5s margin), the status is gone
      await sleep(timer15s.get().left.milliseconds);
      const popcornStatusAfterExpiry = await get('how-popped-is-the-popcorn');
      expect(popcornStatusAfterExpiry).toEqual(undefined); // no longer defined, since the default seconds until expiration was 10
    });
    it('should respect the item level expiration for the cache', async () => {
      const { set, get } = createCache({ directory: directoryToPersistTo }); // remember, default expiration is greater than 1 min

      // create timers before set() so each checkpoint tracks from an absolute TTL start, not from
      // set() return (the genTimer pattern — no relative-sleep drift accumulates across checkpoints).
      // note: WIDE margins on BOTH sides of the 5s item ttl (check at 2s, 3s before; and at 10s, 5s
      //       after), so a multi-second single sleep overshoot under concurrent-suite cpu load can
      //       never straddle the expiry
      const timer2s = genTimer({ for: { seconds: 2 } });
      const timer10s = genTimer({ for: { seconds: 10 } });
      await set('ice-cream-state', 'solid', { expiration: { seconds: 5 } }); // ice cream changes quickly in the heat! lets keep a quick eye on this

      // prove that we recorded the value and its accessible immediately after the set
      const iceCreamState = await get('ice-cream-state');
      expect(iceCreamState).toEqual('solid');

      // prove that the value is still accessible at 2s from TTL start (a wide 3s margin before the 5s ttl)
      await sleep(timer2s.get().left.milliseconds);
      const iceCreamStateBeforeExpiry = await get('ice-cream-state');
      expect(iceCreamStateBeforeExpiry).toEqual('solid'); // still should say solid

      // and prove that well after the 5s ttl (at 10s from TTL start, a 5s margin), the state is gone
      await sleep(timer10s.get().left.milliseconds);
      const iceCreamStateAfterExpiry = await get('ice-cream-state');
      expect(iceCreamStateAfterExpiry).toEqual(undefined); // no longer defined, since the item level seconds until expiration was 5
    });
    it('should consider secondsUntilExpiration of null or infinity as never expiring', async () => {
      const { set, get } = createCache({
        directory: directoryToPersistTo,
        expiration: { seconds: 0 }, // expire immediately
      });

      // prove that setting something to the cache with default state will have it expired immediately
      await set('dory-memory', 'something'); // lets see if dory can remember something
      const doryMemory = await get('dory-memory');
      expect(doryMemory).toEqual(undefined); // its already gone! dang default expiration

      // prove that if we record the memory with expires-at null, it persists
      await set('elephant-memory', 'something', {
        expiration: null,
      });
      const elephantMemory = await get('elephant-memory');
      expect(elephantMemory).toEqual('something');
    });
    it('should return undefined if a key has never been cached', async () => {
      const { get } = createCache({ directory: directoryToPersistTo });
      const value = await get('ghostie');
      expect(value).toEqual(undefined);
    });
    it('should save to disk the value json parsed, if parseable, to make it easier to observe when debugging', async () => {
      const { get, set } = createCache({ directory: directoryToPersistTo });

      // set
      const key = 'city';
      const value = JSON.stringify({
        name: 'atlantis',
        galaxy: 'pegasus',
        code: 821,
      });
      await set(key, value);

      // check that in the file it was json parsed before stringified
      const contents = await fs.readFile(
        [directoryToPersistTo.local.path, key].join('/'),
        {
          encoding: 'utf-8',
        },
      );
      const parsedContents = JSON.parse(contents);
      expect(parsedContents.deserializedForObservability).toEqual(true);
      expect(typeof parsedContents.value).not.toEqual('string');

      // check that we can read the value
      const foundValue = await get(key);
      expect(foundValue).toEqual(value);
    });
    it('should expose the error on set, if a promise that resolves with an error was called to be set to the cache', async () => {
      const { set } = createCache({ directory: directoryToPersistTo });

      // define the value
      const key = 'surprise';
      const expectedError = new Error('surprise!');
      const value = Promise.reject(expectedError);

      // prove the error is thrown onSet
      try {
        await set(key, value);
        throw new Error('should not reach here');
      } catch (error) {
        expect(error).toEqual(expectedError);
      }

      // prove nothing was set into the cache for this key
      const fileExists = await await fs
        .readFile([directoryToPersistTo.local.path, key].join('/'), {
          encoding: 'utf-8',
        })
        .then(() => true)
        .catch((error) => {
          if (error.code === 'ENOENT') return false;
          throw error; // otherwise, something else is messed up
        });
      expect(fileExists).toEqual(false);
    });
    it('should support invalidation by setting a keys value to undefined', async () => {
      const { set, get } = createCache({ directory: directoryToPersistTo });
      await set('is-cereal-soup', 'yes');
      const answer = await get('is-cereal-soup');
      expect(answer).toEqual('yes');
      await set('is-cereal-soup', undefined);
      const answerNow = await get('is-cereal-soup');
      expect(answerNow).toEqual(undefined);
    });
    it('should keep accurate track of keys', async () => {
      // clear out the old keys, so that other tests dont affect the keycounting we want to do here
      await fs.unlink(
        `${directoryToPersistTo.local.path}/${RESERVED_CACHE_KEY_FOR_VALID_KEYS}`,
      );

      // create the cache
      const { set, keys } = createCache({
        directory: directoryToPersistTo,
      });

      // check key is added when value is set
      await set('meaning-of-life', '42');
      const keys1 = await keys();
      expect(keys1.length).toEqual(1);
      expect(keys1[0]).toEqual('meaning-of-life');

      // check that there are no duplicates when key value is updated
      await set('meaning-of-life', '42.0');
      const keys2 = await keys();
      expect(keys2.length).toEqual(1);
      expect(keys2[0]).toEqual('meaning-of-life');

      // check that multiple keys can be set
      await set('purpose-of-life', 'propagation');
      const keys3 = await keys();
      expect(keys3.length).toEqual(2);
      expect(keys3[1]).toEqual('purpose-of-life');

      // check that invalidation removes the key
      await set('meaning-of-life', undefined);
      const keys4 = await keys();
      expect(keys4.length).toEqual(1);
      expect(keys4[0]).toEqual('purpose-of-life');
    });
    it('should return undefined when valid keys says a key exists but the cache file was deleted externally', async () => {
      // create the cache and set a value
      const cacheFirst = createCache({ directory: directoryToPersistTo });
      await cacheFirst.set('schrodingers-cat', 'alive');

      // verify it's accessible
      const catState = await cacheFirst.get('schrodingers-cat');
      expect(catState).toEqual('alive');

      // verify the key is in the valid keys
      const keys1 = await cacheFirst.keys();
      expect(keys1).toContain('schrodingers-cat');

      // simulate external deletion of the cache file (e.g., cloud object deleted, local disk corruption, etc.)
      await fs.unlink(`${directoryToPersistTo.local.path}/schrodingers-cat`);

      // create a new cache instance to clear the in-memory cache
      const cacheSecond = createCache({ directory: directoryToPersistTo });

      // the key should still be in valid keys (since we didn't update that file)
      const keys2 = await cacheSecond.keys();
      expect(keys2).toContain('schrodingers-cat');

      // but getting the value should return undefined since the file doesn't exist
      const catStateAfterDeletion = await cacheSecond.get('schrodingers-cat');
      expect(catStateAfterDeletion).toEqual(undefined);
    });
    it('should return undefined for a corrupt (unparseable) cache file', async () => {
      // .why = a cache file whose bytes are not valid json is a known-degraded state; the
      //        canonical envelope reader counts it as logically absent (get → undefined),
      //        rather than a raw JSON.parse throw propagated up to the caller
      const cache = createCache({ directory: directoryToPersistTo });
      const key = 'corrupt-envelope';

      // write raw non-json bytes directly, to simulate a truncated / clobbered cache file
      await fs.writeFile(
        `${directoryToPersistTo.local.path}/${key}`,
        'not-json',
        { encoding: 'utf-8' },
      );

      // a fresh instance (no memory) must read the corrupt file as absent, not fail loud
      const value = await createCache({ directory: directoryToPersistTo }).get(
        key,
      );
      expect(value).toEqual(undefined);

      // and it stays coherent — a subsequent set + get round-trips normally
      await cache.set(key, 'healed');
      expect(await cache.get(key)).toEqual('healed');
    });
    it('should prevent redundant local disk reads to maximize speed', async () => {
      // clear out the old keys, so that other tests dont affect the keycounting we want to do here
      await fs.unlink(
        `${directoryToPersistTo.local.path}/${RESERVED_CACHE_KEY_FOR_VALID_KEYS}`,
      );

      // .spy = a pure OBSERVATION spy on the real fs.readFile — NOT a mock
      // .why = per rule.forbid.integration.mocks' exception clause + the org lesson "can spy, but
      //        never mock": this jest.spyOn carries NO .mockImplementation / .mockReturnValue, so
      //        the genuine fs.readFile still runs against the real local disk (the integration stays real).
      //        the spy only tallies call counts — the sole way to assert the redundant-read-prevention
      //        behavior (that a memory-first hit serves from memory and does NOT re-hit the local disk), which
      //        has no observable side effect to check other than "how many times did we read the local disk?".
      const readFileSpy = jest.spyOn(fs, 'readFile');

      // create the cache in memory-first mode, since that is where the redundant-read prevention lives
      const cacheFirst = createCache({
        directory: directoryToPersistTo,
        consistency: 'memory-first',
      });

      // set a value
      await cacheFirst.set('meaning-of-life', '42');

      // verify the expected number of local disk reads
      // .why = a real-key local set now reads twice: once for the valid_keys index, and once for the
      //        lock-ownership check the compare-and-delete release performs before it unlinks the lock
      //        (the per-key lock that guards every local write, conditional or not — see the readme's
      //        "behavior change for ALL local writes" note).
      expect(readFileSpy).toHaveBeenCalledTimes(2);

      // get the value
      const valueFirst = await cacheFirst.get('meaning-of-life');
      expect(valueFirst).toEqual('42');

      // verify that we did not readFile any more times, since it should have been .set to memory already
      expect(readFileSpy).toHaveBeenCalledTimes(2);

      // now, create a new cache, to clear out the in memory cache
      const cacheSecond = createCache({
        directory: directoryToPersistTo,
        consistency: 'memory-first',
      });

      // get the value again
      const valueSecond = await cacheSecond.get('meaning-of-life');
      expect(valueSecond).toEqual('42'); // same value

      // verify that we read from disk once to find it, since it was not in memory
      // .why = the running tally is now 4: the earlier set's 2 reads (valid_keys + lock release),
      //        plus this cold memory-first get's 2 reads (valid_keys + the value file) on read-through.
      expect(readFileSpy).toHaveBeenCalledTimes(4); // 2x get on read through

      // get the value again
      const valueThird = await cacheSecond.get('meaning-of-life');
      expect(valueThird).toEqual('42'); // same value

      // verify that we did not readFile any more times, since it should have been .set to memory already
      expect(readFileSpy).toHaveBeenCalledTimes(4);
    });
    describe('consistency', () => {
      // a second cache instance has its own memory closure, so it stands in for a different process writing to the same store
      it('should default to source-first: reflect a cross-process overwrite', async () => {
        const key = 'election-source-first';
        const cacheA = createCache({ directory: directoryToPersistTo }); // default source-first
        const cacheB = createCache({ directory: directoryToPersistTo }); // separate memory = a different process

        // cacheA writes the first value
        await cacheA.set(key, 'tokenA');
        expect(await cacheA.get(key)).toEqual('tokenA');

        // cacheB overwrites the source, out of cacheA's process
        await cacheB.set(key, 'tokenB');

        // cacheA, being source-first, sees the overwrite
        expect(await cacheA.get(key)).toEqual('tokenB');
      });
      it('should serve a stale value on a memory-first cache after a cross-process overwrite', async () => {
        const key = 'election-memory-first';
        const cacheA = createCache({
          directory: directoryToPersistTo,
          consistency: 'memory-first',
        });
        const cacheB = createCache({ directory: directoryToPersistTo });

        // cacheA writes and warms its memory
        await cacheA.set(key, 'tokenA');
        expect(await cacheA.get(key)).toEqual('tokenA');

        // cacheB overwrites the source
        await cacheB.set(key, 'tokenB');

        // cacheA still returns its warm memory copy (stale, as expected for memory-first)
        expect(await cacheA.get(key)).toEqual('tokenA');
      });
      it('should let a per-read source-first override bypass memory and keep it warm', async () => {
        const key = 'election-override';
        const cacheA = createCache({
          directory: directoryToPersistTo,
          consistency: 'memory-first',
        });
        const cacheB = createCache({ directory: directoryToPersistTo });

        // cacheA writes and warms its memory
        await cacheA.set(key, 'tokenA');
        expect(await cacheA.get(key)).toEqual('tokenA');

        // cacheB overwrites the source
        await cacheB.set(key, 'tokenB');

        // a per-read source-first override sees the fresh value, past memory
        expect(await cacheA.get(key, { consistency: 'source-first' })).toEqual(
          'tokenB',
        );

        // and it leaves memory warm with the fresh value, so later memory-first reads see it too
        expect(await cacheA.get(key)).toEqual('tokenB');
      });
    });
  });
  describe('cloud', () => {
    const directoryToPersistTo = {
      cloud: {
        path: 's3://ehmpathy-simple-on-disk-cache-test-bucket/test/integration/s3/',
        via: sdkAwsS3,
      },
    };
    it('should be able to add an item to the cache', async () => {
      const { set } = createCache({ directory: directoryToPersistTo });
      await set('meaning-of-life', '42');
    });
    it('should be able to get an item from the cache', async () => {
      const { set, get } = createCache({ directory: directoryToPersistTo });
      await set(
        'how-many-licks-does-it-take-to-get-to-the-center-of-a-tootsie-pop',
        '3',
      );
      const licks = await get(
        'how-many-licks-does-it-take-to-get-to-the-center-of-a-tootsie-pop',
      );
      expect(licks).toEqual('3');
    });
    it('should respect the default expiration for the cache', async () => {
      const { set, get } = createCache({
        directory: directoryToPersistTo,
        expiration: { seconds: 10 },
      }); // we're gonna use this cache to keep track of the popcorn in the microwave - we should check more regularly since it changes quickly!

      // create timers before set() so each checkpoint tracks from an absolute TTL start, not from
      // set() return (the genTimer pattern — no relative-sleep drift accumulates across checkpoints).
      // note: WIDE 5s margins on BOTH sides of the 10s ttl boundary, so even a multi-second single
      //       sleep overshoot under concurrent-suite + real-s3 load can never straddle the expiry —
      //       the pre-expiry check fires at 5s (5s before) and the post-expiry check at 15s (5s after)
      const timer5s = genTimer({ for: { seconds: 5 } });
      const timer15s = genTimer({ for: { seconds: 15 } });
      await set('how-popped-is-the-popcorn', 'not popped');

      // prove that we recorded the value and its accessible immediately after set
      const popcornStatus = await get('how-popped-is-the-popcorn');
      expect(popcornStatus).toEqual('not popped');

      // prove that the value is still accessible at 5s from TTL start (a wide 5s margin before expiry)
      await sleep(timer5s.get().left.milliseconds);
      const popcornStatusBeforeExpiry = await get('how-popped-is-the-popcorn');
      expect(popcornStatusBeforeExpiry).toEqual('not popped'); // still should say not popped

      // and prove that well after the 10s ttl (at 15s from TTL start, a 5s margin), the status is gone
      await sleep(timer15s.get().left.milliseconds);
      const popcornStatusAfterExpiry = await get('how-popped-is-the-popcorn');
      expect(popcornStatusAfterExpiry).toEqual(undefined); // no longer defined, since the default seconds until expiration was 10
    });
    it('should respect the item level expiration for the cache', async () => {
      const { set, get } = createCache({ directory: directoryToPersistTo }); // remember, default expiration is greater than 1 min

      // create timers before set() so they track from TTL start, not set() return
      // note: wide windows (12s ttl, checks at 5s + 16s) absorb s3 latency; under the source-first default every get hits s3 (~2-4s each), so tight margins would flake as accumulated read latency drifts past the ttl boundary
      const timer5s = genTimer({ for: { seconds: 5 } });
      const timer16s = genTimer({ for: { seconds: 16 } });
      await set('ice-cream-state', 'solid', { expiration: { seconds: 12 } }); // ice cream changes quickly in the heat! lets keep a quick eye on this

      // prove that we recorded the value and its accessible immediately after set
      const iceCreamState = await get('ice-cream-state');
      expect(iceCreamState).toEqual('solid');

      // prove that the value is still accessible after 5 seconds from TTL start (well before the 12s ttl)
      await sleep(timer5s.get().left.milliseconds);
      const iceCreamStateAfter5Sec = await get('ice-cream-state');
      expect(iceCreamStateAfter5Sec).toEqual('solid'); // still should say solid

      // and prove that after 16 seconds from TTL start (well past the 12s ttl), the state is no longer in the cache
      await sleep(timer16s.get().left.milliseconds);
      const iceCreamStateAfter16Sec = await get('ice-cream-state');
      expect(iceCreamStateAfter16Sec).toEqual(undefined); // no longer defined, since the item level seconds until expiration was 12
    });
    it('should return undefined if a key has never been cached', async () => {
      const { get } = createCache({ directory: directoryToPersistTo });
      const value = await get('ghostie');
      expect(value).toEqual(undefined);
    });
    it('should support an async getter for the directory to persist to', async () => {
      const { set, get } = createCache({ directory: directoryToPersistTo });
      await set('what-do-you-call-a-fake-noodle', 'an-impasta');
      const answer = await get('what-do-you-call-a-fake-noodle');
      expect(answer).toEqual('an-impasta');
    });
    it('should handle cloud path without terminal slash', async () => {
      const directoryWithoutSlash = {
        cloud: {
          path: 's3://ehmpathy-simple-on-disk-cache-test-bucket/test/integration/s3', // no terminal slash
          via: sdkAwsS3,
        },
      };
      const { set, get } = createCache({ directory: directoryWithoutSlash });
      await set('slash-test', 'works');
      const value = await get('slash-test');
      expect(value).toEqual('works');
    });
    describe('consistency', () => {
      // a second cache instance has its own memory closure, so it stands in for a different process writing to the same store
      it('should default to source-first: reflect a cross-process overwrite', async () => {
        const key = 'election-source-first';
        const cacheA = createCache({ directory: directoryToPersistTo }); // default source-first
        const cacheB = createCache({ directory: directoryToPersistTo }); // separate memory = a different process

        // cacheA writes the first value
        await cacheA.set(key, 'tokenA');
        expect(await cacheA.get(key)).toEqual('tokenA');

        // cacheB overwrites the source, out of cacheA's process
        await cacheB.set(key, 'tokenB');

        // cacheA, being source-first, sees the overwrite
        expect(await cacheA.get(key)).toEqual('tokenB');
      });
      it('should serve a stale value on a memory-first cache after a cross-process overwrite', async () => {
        const key = 'election-memory-first';
        const cacheA = createCache({
          directory: directoryToPersistTo,
          consistency: 'memory-first',
        });
        const cacheB = createCache({ directory: directoryToPersistTo });

        // cacheA writes and warms its memory
        await cacheA.set(key, 'tokenA');
        expect(await cacheA.get(key)).toEqual('tokenA');

        // cacheB overwrites the source
        await cacheB.set(key, 'tokenB');

        // cacheA still returns its warm memory copy (stale, as expected for memory-first)
        expect(await cacheA.get(key)).toEqual('tokenA');
      });
      it('should let a per-read source-first override bypass memory and keep it warm', async () => {
        const key = 'election-override';
        const cacheA = createCache({
          directory: directoryToPersistTo,
          consistency: 'memory-first',
        });
        const cacheB = createCache({ directory: directoryToPersistTo });

        // cacheA writes and warms its memory
        await cacheA.set(key, 'tokenA');
        expect(await cacheA.get(key)).toEqual('tokenA');

        // cacheB overwrites the source
        await cacheB.set(key, 'tokenB');

        // a per-read source-first override sees the fresh value, past memory
        expect(await cacheA.get(key, { consistency: 'source-first' })).toEqual(
          'tokenB',
        );

        // and it leaves memory warm with the fresh value, so later memory-first reads see it too
        expect(await cacheA.get(key)).toEqual('tokenB');
      });
    });
  });
});
