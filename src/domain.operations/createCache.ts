import { promises as fs } from 'fs';
import type { IsoDuration } from 'iso-time';
import { createCache as createInMemoryCache } from 'simple-in-memory-cache';
import { withNot } from 'type-fns';
import { genBottleneck } from 'with-bottleneck';

import type { DirectoryToPersistTo } from '../domain.objects/DirectoryToPersistTo';
import type { KeyWithMetadata } from '../domain.objects/KeyWithMetadata';
import { RESERVED_CACHE_KEY_FOR_VALID_KEYS } from '../domain.objects/RESERVED_CACHE_KEY_FOR_VALID_KEYS';
import type { SimpleCacheCondition } from '../domain.objects/SimpleCacheCondition';
import type { SimpleOnDiskCache } from '../domain.objects/SimpleOnDiskCache';
import type { SimpleOnDiskCacheConsistency } from '../domain.objects/SimpleOnDiskCacheConsistency';
import { assertConditionMet } from './condition/assertConditionMet';
import { getDirectoryToPersistTo } from './directory/getDirectoryToPersistTo';
import { isLocalDirectory } from './directory/isLocalDirectory';
import { getSourceStateForCondition } from './disk/getSourceStateForCondition';
import { getSourceVersion } from './disk/getSourceVersion';
import { setToDisk } from './disk/setToDisk';
import { setToDiskConditional } from './disk/setToDiskConditional';
import { asSerializedEnvelope } from './envelope/asSerializedEnvelope';
import { getExpiresAtMse } from './envelope/getExpiresAtMse';
import { getMemoryExpiration } from './envelope/getMemoryExpiration';
import { getValidKeysWithKeyUpserted } from './envelope/getValidKeysWithKeyUpserted';
import { isRecordExpired } from './envelope/isRecordExpired';
import { assertIsNotReservedCacheKey } from './key/assertIsNotReservedCacheKey';
import { assertIsValidOnDiskCacheKey } from './key/assertIsValidOnDiskCacheKey';
import { asKeysList } from './validkeys/asKeysList';
import { asParsedValidKeys } from './validkeys/asParsedValidKeys';
import { asSerializedValidKeys } from './validkeys/asSerializedValidKeys';

/**
 * create a simple on-disk cache
 */
export const createCache = ({
  directory: directoryToPersistToInput,
  expiration: defaultExpiration = { minutes: 5 },
  consistency: defaultConsistency = 'source-first',
}: {
  /**
   * .what = the directory into which to persist the cache
   */
  directory: DirectoryToPersistTo | (() => Promise<DirectoryToPersistTo>);

  /**
   * .what = how long to keep items cached until they expire, by default
   */
  expiration?: IsoDuration | null;

  /**
   * .what = the read consistency policy for the cache
   * .why = source-first (default) always reflects the latest write; memory-first opts into speed for single-writer usecases
   */
  consistency?: SimpleOnDiskCacheConsistency;
}): SimpleOnDiskCache => {
  // derive the directory AND ensure it exists before any op — every get/set awaits this same
  // promise, so the mkdir is guaranteed complete before the first read/write. folding the mkdir into
  // the awaited promise (not a fire-and-forget `void …then`) removes the order-dependent race where a
  // first write could land before the directory was created.
  const promiseDirectoryToPersistTo =
    (async (): Promise<DirectoryToPersistTo> => {
      const directoryToPersistTo = await getDirectoryToPersistTo(
        directoryToPersistToInput,
      );
      if (isLocalDirectory(directoryToPersistTo))
        await fs.mkdir(directoryToPersistTo.local.path, { recursive: true });
      return directoryToPersistTo;
    })();

  // serialize this instance's valid-keys writes to at most one at a time (within one machine),
  // to prevent a corrupted key file on a mounted directory + same-machine read-modify-write races.
  // .why per-instance (NOT module scope): createCache is a factory for INDEPENDENT caches — a
  //      module-scoped bottleneck would serialize the valid-keys writes of two unrelated caches
  //      (different directories, tenants, subsystems) against each other for no domain reason.
  const updateKeyFileBottleneck = genBottleneck({ concurrency: 1 });

  /**
   * .what = write a value to the source store, optionally under a version precondition (put-if-absent
   *         / compare-and-set), and return the key + its computed expiry
   * .why = the core write primitive every higher set-wrapper composes; centralizes envelope
   *        serialization, the conditional-vs-unconditional dispatch, and expiry computation
   */
  const set = async (
    key: string,
    value: string | undefined | Promise<string | undefined>,
    {
      expiration = defaultExpiration,
      condition,
    }: {
      expiration?: IsoDuration | null;
      condition?: SimpleCacheCondition;
    } = {},
  ): Promise<KeyWithMetadata> => {
    assertIsValidOnDiskCacheKey({ key });

    // await the value FIRST, then compute the expiry from the resolved value — so an async
    // invalidation (a promise that resolves to undefined) is treated as a tombstone (expiry 0),
    // identical to a direct `undefined`. an expiry off the raw promise would miss this and write a
    // future-dated tombstone that blocks a later put-if-absent.
    const awaitedValue = await value;
    const expiresAtMse = getExpiresAtMse({ value: awaitedValue, expiration });

    // serialize the value into the on-disk envelope json
    const serialized = asSerializedEnvelope({
      value: awaitedValue,
      expiresAtMse,
    });

    // save to the source — conditionally (put-if-absent / compare-and-set) when a condition is
    // set, else an unconditional last-writer-wins write
    const directoryToPersistTo = await promiseDirectoryToPersistTo;
    await (condition
      ? setToDiskConditional({
          directory: directoryToPersistTo,
          key,
          value: serialized,
          condition,
        })
      : setToDisk({
          directory: directoryToPersistTo,
          key,
          value: serialized,
        }));

    // return the  key with metadata
    return {
      key,
      expiresAtMse,
    };
  };

  /**
   * .what = read a key's value straight from the source store (past memory + the valid_keys index),
   *         honoring expiry; a corrupt or expired or absent entry reads as undefined
   * .why = the raw physical read the conditional gate + the source-first path both build on, so the
   *        version check and the value it guards come from the same physical layer
   */
  const get = async (key: string): Promise<string | undefined> => {
    assertIsValidOnDiskCacheKey({ key });
    const directoryToPersistTo = await promiseDirectoryToPersistTo;

    // read the value through the shared source pipeline (tier-dispatch → parse → corrupt-as-absent
    // + warn → expiry → value), but with version:false — a plain get needs only the value, so it skips
    // the content-hash on the local disk and the include.meta demand on the cloud adapter. this keeps
    // ONE parse/expiry pipeline shared with every conditional op + version() (no drift), while a plain
    // read stays zero-cost and works against a custom adapter that ignores include.meta.
    const { value } = await getSourceStateForCondition({
      directory: directoryToPersistTo,
      key,
      include: { version: false },
    });
    return value;
  };

  /**
   * define how to lookup valid keys for the cache
   */
  const getValidKeysWithMetadata = async () => {
    // lookup the last saved valid keys
    const cachedValidKeysSerialized = await get(
      RESERVED_CACHE_KEY_FOR_VALID_KEYS,
    );
    const cachedValidKeys = asParsedValidKeys(cachedValidKeysSerialized);
    const validKeys = cachedValidKeys.filter(withNot(isRecordExpired));
    return validKeys;
  };

  /**
   * define how to save valid keys for the cache
   *
   * note
   * - record a key w/ effectiveAtMse = 0 to invalidate it
   *
   * TODO: eventually, support lossless high-concurrency writing (potentially optionally, as a cache option, since it's not important for most applications)
   * - we need some way of ensuring that parallel processes wont conflict + overwrite eachother
   *   - for example, imagine you have two keys that were set to cache in parallel
   *     - requestA = [...savedKeys, newKeyA]
   *     - requestB = [...savedKeys, newKeyB]
   *     - read-before-write would make it so that either newKeyA or newKeyB is dropped and doesn't make it to the final destination // TODO: lookup the formal word for this race condition, its common in dbs
   *   - in other words,
   *     - there is a risk a query _will_ have been cached but not saved to the valid keys -> immediately invalidated
   *     - this is a safe failure mode, as it's the same as the query never having been cached in the first place (i.e., just requires extra requests)
   *   - if we find a usecase where it _is_ critical to solve, we can do so
   *     - probably with
   *       - per-thread "append" file (which all read from, but only one thread writes to)  (similar in spi)
   *       - plus
   *       - globally locked global file update, similar to
   *       - inspiration: https://stackoverflow.com/a/53193851/3068233
   *     - OR, now that this feature ships compare-and-set: read the reserved record + its version,
   *       merge the key, and set() under `condition: { version }`; on a SimpleCacheConditionError
   *       (a concurrent writer won) re-read + re-merge + retry — a lossless merge with no dropped key.
   *       to adopt it is a separate, wisher-gated change (see the .note below + 1.vision open-questions).
   *
   * .note = this write is an IDEMPOTENT UPSERT (it overwrites the reserved record with the merged
   *         list), so a single-writer RETRY is safe — a re-run yields the same final state, per
   *         `rule.forbid.nonidempotent-mutations`, which sanctions upsert. the residual concern is
   *         NOT idempotency but a CROSS-PROCESS LOST-UPDATE (a race-condition): two OS processes that
   *         read-then-write concurrently can each drop the other's key. that race is held by design,
   *         DOUBLY justified:
   *         1. the wisher explicitly deferred the compare-and-set fix (a wish motivation, not an
   *            acceptance criterion — see 1.vision open-questions). this feature ENABLES the lossless
   *            fix; to adopt it is a separate, wisher-gated change.
   *         2. the obvious "just take the per-key lock on the reserved key" fix was itself already
   *            evaluated and REJECTED (see setToDisk's reserved-key branch, the scope note): a
   *            cross-process lock on this one shared key would add a NEW, LOUDER failure mode — a
   *            plain unconditional consumer could see set() throw the lock-deadline error under
   *            contention. so the pre-feature unlocked atomic write is kept on purpose. the current
   *            failure mode is the quieter, safe one: a key may be cached but not tracked → treated
   *            as never-cached → an extra request, never data loss or corruption.
   */
  const updateKeyWithMetadataState = async ({
    for: forKeyWithMetadata,
  }: {
    for: KeyWithMetadata;
  }) => {
    // write inside of a bottleneck, so that within ONE machine no more than one thread writes this
    // file at a time; prevents corrupted key files on mounted directories + same-machine races.
    // .note = the reserved valid-keys key is serialized in-process by this bottleneck ONLY. it does
    //         NOT take the cross-process per-key `#lock` (setToDisk skips the lock for this one key
    //         on purpose — see its reserved-key branch). so a second os process can still
    //         race the read-modify-write; that residual race is the wisher-deferred, safe-drop
    //         behavior documented above, unchanged by this feature.
    return updateKeyFileBottleneck.schedule(async () => {
      // lookup current valid keys, then upsert this key's fresh metadata into the list
      const currentKeysWithMetadata = await getValidKeysWithMetadata();
      const nextKeysWithMetadata = getValidKeysWithKeyUpserted({
        current: currentKeysWithMetadata,
        for: forKeyWithMetadata,
      });

      // save the merged list back to the reserved valid-keys record
      await set(
        RESERVED_CACHE_KEY_FOR_VALID_KEYS,
        asSerializedValidKeys(nextKeysWithMetadata),
        {
          expiration: null,
        },
      );
    });
  };

  /**
   * .what = write via set(), then record the key in the valid_keys index so keys() can enumerate it
   * .why = keys() reads the valid_keys index as its source of truth; every tracked write must update
   *        it, else a written key would be invisible to keys() (or a deleted one would linger)
   */
  const setWithValidKeyTracked = async (
    ...args: Parameters<typeof set>
  ): Promise<KeyWithMetadata> => {
    // write to the cache
    const newKeyWithMetadata = await set(...args);

    // add the key as valid
    await updateKeyWithMetadataState({ for: newKeyWithMetadata });

    // return metadata so caller can compute TTL left
    return newKeyWithMetadata;
  };

  /**
   * define how to get valid keys
   */
  const getValidKeys = async () =>
    getValidKeysWithMetadata().then((keysWithMetadata) =>
      asKeysList(keysWithMetadata),
    );

  /**
   * define how to get an item from the cache, synced with valid key tracking
   */
  const getWithValidKeyTracking = async (
    ...args: Parameters<typeof get>
  ): ReturnType<typeof get> => {
    // if its not a valid key, then dont try to get (this is critical, as it ensures that the validKeys array is a source of truth)
    const validKeys = await getValidKeys();
    if (!validKeys.includes(args[0])) return undefined; // if the key is not valid, then no value

    // otherwise, lookup the value
    return get(...args);
  };

  /**
   * wrap the get and set around an in memory cache, to prevent redundant local disk reads
   *
   * why?
   * - local disk reads are ~15ms each
   * - memory reads are nanoseconds (1000x faster)
   * - with memory.hit before local disk hit, performance improves massively for cache.hits
   */
  const cacheInMemory = createInMemoryCache<
    string | undefined | Promise<string | undefined>
  >({
    expiration: defaultExpiration,
  });
  /**
   * keep the in-memory tier warm with a fresh source value, only when this is a memory-first cache
   *
   * .why = a source-first cache never reads memory, so a memory write would be dead work. both the
   *        source-first-override read and the conditional read refresh memory this one way.
   */
  const warmMemoryIfMemoryFirst = async (
    key: string,
    value: string | undefined,
  ): Promise<void> => {
    if (defaultConsistency === 'memory-first' && value !== undefined)
      await cacheInMemory.set(key, value);
  };
  const getWithMemory = async (key: string): ReturnType<typeof get> => {
    // check in memory, to prevent disk hits. compare against undefined (NOT truthiness): an empty
    // string is a legitimate cached value, so a truthy guard would misread '' as a miss and force
    // a needless disk read
    const valueFoundInMemoryBefore = await cacheInMemory.get(key);
    if (valueFoundInMemoryBefore !== undefined) return valueFoundInMemoryBefore;

    // if not in memory, then .get from disk. again compare against undefined, so a stored empty
    // string returns '' rather than collapse to undefined (which would drop a real value)
    const valueFoundOnDisk = await getWithValidKeyTracking(key);
    if (valueFoundOnDisk === undefined) return undefined; // if not found on disk either, then defo undefined

    // since found on disk, set to in memory cache, for successful subsequent lookups
    await cacheInMemory.set(key, valueFoundOnDisk);

    // return the disk value directly — the in-memory tier stores the string verbatim, so a
    // read-back would return this exact value; the extra get was a redundant round trip
    return valueFoundOnDisk;
  };

  /**
   * define how to get an item from the cache, per the effective read consistency
   *
   * .why =
   * - source-first (default): read the source store every time; reflects the latest write, cross-process overwrites included
   * - memory-first (opt-in): an in-process memory hit short-circuits the source read, for speed
   * - options.consistency overrides the cache-wide default for this one read
   */
  const getWithConsistency = async (
    key: string,
    options?: {
      consistency?: SimpleOnDiskCacheConsistency;
      condition?: SimpleCacheCondition;
    },
  ): ReturnType<typeof get> => {
    // fail fast on an invalid key before ANY source read touches the filesystem — mirrors set()
    // and version(). the conditional branch below reads the source directly
    // (getSourceStateForCondition), which builds a filesystem path, so the path-traversal guard must
    // run here rather than only inside the downstream internal get() — else one entry point would
    // skip the guard the rest run.
    assertIsValidOnDiskCacheKey({ key });

    // reject the internal valid-keys sentinel key at the public boundary — a caller who reads it
    // would expose the internal index; the internal maintenance reads funnel through internal get()
    assertIsNotReservedCacheKey({ key });

    // conditional read: gate on the current physical version AND read the value from the SAME
    // physical read (getSourceStateForCondition reads the source directly — past both the memory
    // tier AND the valid_keys index — and yields the version + value from one envelope). one read for
    // both is atomic: no write can land between a version check and a value read to return a value
    // past the just-checked version (the prior two-read TOCTOU is gone).
    if (options?.condition) {
      const directoryToPersistTo = await promiseDirectoryToPersistTo;
      const { found, value: valueFromSource } =
        await getSourceStateForCondition({
          directory: directoryToPersistTo,
          key,
        });
      assertConditionMet({ key, condition: options.condition, found });

      // keep memory warm with the fresh value, exactly as the source-first override does — else a
      // memory-first cache could serve a stale in-memory copy on the next plain get, right after a
      // conditional read just proved the fresh version
      await warmMemoryIfMemoryFirst(key, valueFromSource);

      return valueFromSource;
    }

    const consistency = options?.consistency ?? defaultConsistency;

    // memory-first: check memory before disk, to save reads
    if (consistency === 'memory-first') return getWithMemory(key);

    // source-first: read the source store directly, past any memory copy
    const valueFoundOnDisk = await getWithValidKeyTracking(key);

    // if this cache uses memory (memory-first default), keep it warm with the fresh value
    await warmMemoryIfMemoryFirst(key, valueFoundOnDisk);

    return valueFoundOnDisk;
  };
  /**
   * define how to set an item to the cache, per the cache's consistency policy
   *
   * .what = writes the source store always; writes the in-memory copy only for a memory-first cache
   * .why = a source-first cache never reads from memory, so a memory write would be dead work
   */
  const setWithConsistency = async (
    ...args: Parameters<typeof set>
  ): Promise<void> => {
    // reject the internal valid-keys sentinel key at the public boundary — a caller writing it would
    // corrupt the index; the internal index upsert funnels through the internal set(), not this
    assertIsNotReservedCacheKey({ key: args[0] });

    // set to disk first, get the computed expiresAtMse
    const { expiresAtMse } = await setWithValidKeyTracked(...args);

    // a source-first cache never reads from memory, so skip the memory write (no dead work)
    if (defaultConsistency !== 'memory-first') return;

    /**
     * set to memory with expiresAtMseLeft (TTL left from the disk's perspective)
     *
     * .why = both caches must expire at the same absolute time
     *
     * any disk write takes some wall-clock time, so the two tiers would skew if each computed its
     * own expiresAt from getMseNow(). the skew is tiny for a local disk (ms) but large for a cloud
     * disk (s3 latency), so the worked example below uses a ~2500ms cloud-disk write to show it:
     * - the disk computes expiresAt at T=0
     * - the cloud disk write takes ~2500ms (s3 latency)
     * - memory computes expiresAt at T=2500
     * - the two caches disagree by 2500ms
     *
     * with expiresAtMseLeft, memory uses the time left until the disk's expiresAt:
     * - the disk computes expiresAt = 5000 at T=0
     * - the cloud disk write completes at T=2500
     * - expiresAtMseLeft = 5000 - 2500 = 2500
     * - memory sets expiresAt = 2500 + 2500 = 5000
     * - both expire at T=5000
     */
    const [key, value] = args;

    // store the RESOLVED value in memory, never the raw promise (memory must hold the string)
    const resolvedValue = await value;
    await cacheInMemory.set(key, resolvedValue, {
      expiration: getMemoryExpiration({ expiresAtMse }),
    });
  };

  /**
   * define how to read the current opaque version token for a key
   *
   * .what = the etag of the stored value (content hash on the local disk, server etag on the
   *         cloud disk), or undefined when the key is logically absent (never cached, or expired)
   * .why = reads the source store directly (past any memory tier), so the version reflects the
   *        true cross-process state — safe to pair with a version condition on get/set
   * .note = the name `version` (not `getVersion`) is contract-mandated: it mirrors
   *         `WithCacheConditionals` from with-simple-cache exactly, so the exported cache
   *         satisfies that interface. the get/set/gen verb rule exempts contract entry points.
   */
  const version = async (key: string): Promise<string | undefined> => {
    assertIsValidOnDiskCacheKey({ key });
    assertIsNotReservedCacheKey({ key }); // reject the internal sentinel at the public boundary
    const directoryToPersistTo = await promiseDirectoryToPersistTo;
    return getSourceVersion({ directory: directoryToPersistTo, key });
  };

  /**
   * return the api
   */
  return {
    set: setWithConsistency,
    get: getWithConsistency,
    version,
    keys: getValidKeys,
  };
};
