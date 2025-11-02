import { UnexpectedCodePathError } from '@ehmpathy/error-fns';
import { toMilliseconds, UniDuration } from '@ehmpathy/uni-time';
import Bottleneck from 'bottleneck';
import { promises as fs } from 'fs';
import { createCache as createInMemoryCache } from 'simple-in-memory-cache';
import { isAFunction, isPresent, withNot } from 'type-fns';

import { assertIsValidOnDiskCacheKey } from './key/assertIsValidOnDiskCacheKey';
import { s3 } from './utils/s3';

const updateKeyFileBottleneck = new Bottleneck({ maxConcurrent: 1 });

export interface SimpleOnDiskCache {
  /**
   * get a value from cache by key
   */
  get: (key: string) => Promise<string | undefined>;

  /**
   * set a value to cache for key
   */
  set: (
    key: string,
    value: string | undefined | Promise<string | undefined>,
    options?: { expiration?: UniDuration | null },
  ) => Promise<void>;

  /**
   * list all valid keys in cache
   */
  keys: () => Promise<string[]>;
}

export const RESERVED_CACHE_KEY_FOR_VALID_KEYS =
  '_.simple_on_disk_cache.valid_keys';

/**
 * the shape of a key with metadata
 */
interface KeyWithMetadata {
  key: string;
  expiresAtMse: number;
}

/**
 * the directory to persist your cache to can be either locally mounted or remote
 *
 * supported remote options:
 * - AWS S3
 */
export type DirectoryToPersistTo =
  | { mounted: { path: string } }
  | { s3: { bucket: string; prefix: string } };

const isMountedDirectory = (
  directory: DirectoryToPersistTo,
): directory is { mounted: { path: string } } =>
  !!(directory as any)?.mounted?.path;
const isS3Directory = (
  directory: DirectoryToPersistTo,
): directory is { s3: { bucket: string; prefix: string } } =>
  !!(directory as any)?.s3?.bucket;

const getMseNow = () => new Date().getTime();

const saveToDisk = async ({
  directory,
  key,
  value,
}: {
  directory: DirectoryToPersistTo;
  key: string;
  value: string;
}) => {
  if (isMountedDirectory(directory))
    return await fs.writeFile([directory.mounted.path, key].join('/'), value, {
      flag: 'w',
      encoding: 'utf-8',
    });
  if (isS3Directory(directory))
    return await s3.putObject({
      bucket: directory.s3.bucket,
      key: [directory.s3.prefix, key].join('/'),
      data: value,
    });
  throw new UnexpectedCodePathError(
    'directory was neither mounted or s3. unsupported',
  );
};

const readFromDisk = async ({
  directory,
  key,
}: {
  directory: DirectoryToPersistTo;
  key: string;
}) => {
  if (isMountedDirectory(directory))
    return await fs
      .readFile([directory.mounted.path, key].join('/'), {
        encoding: 'utf-8',
      })
      .catch((error) => {
        if (error.code === 'ENOENT') return undefined; // file not found error => never cached
        throw error; // otherwise, something else is messed up
      });
  if (isS3Directory(directory))
    return await s3
      .getObjectAsString({
        bucket: directory.s3.bucket,
        key: [directory.s3.prefix, key].join('/'),
      })
      .catch((error) => {
        if (error.message.includes('Could not find object in s3 in bucket'))
          return undefined;
        throw error;
      });
  throw new UnexpectedCodePathError(
    'directory was neither mounted or s3. unsupported',
  );
};

/**
 * a utility function for deciding whether a record is valid
 */
export const isRecordExpired = ({
  expiresAtMse,
}: {
  expiresAtMse: number | number;
}) => {
  // if expiresAtMse = null, then it never expires
  if (expiresAtMse === null) return false;

  // otherwise, check whether its expired
  return expiresAtMse < getMseNow();
};

/**
 * declares a method that's able to resolve the directory to persist to
 *
 * supports
 * - async getters
 * - direct declaration
 */
const resolveDirectoryToPersistTo = async (
  input: DirectoryToPersistTo | (() => Promise<DirectoryToPersistTo>),
): Promise<DirectoryToPersistTo> =>
  isAFunction(input) ? await input() : input;

/**
 * create a simple on-disk cache
 */
export const createCache = ({
  directory: directoryToPersistToInput,
  expiration: defaultExpiration = { minutes: 5 },
}: {
  /**
   * .what = the directory into which to persist the cache
   */
  directory: DirectoryToPersistTo | (() => Promise<DirectoryToPersistTo>);

  /**
   * .what = how long to keep items cached until they expire, by default
   */
  expiration?: UniDuration | null;
}): SimpleOnDiskCache => {
  // kick off a promise to get the directory to persist to
  const promiseDirectoryToPersistTo = resolveDirectoryToPersistTo(
    directoryToPersistToInput,
  );

  // kick off creating the directory if it doesn't already exist, to prevent usage errors
  void promiseDirectoryToPersistTo.then(async (directoryToPersistTo) => {
    if (isMountedDirectory(directoryToPersistTo))
      await fs.mkdir(directoryToPersistTo.mounted.path, { recursive: true });
  });

  /**
   * define how to set an item into the cache
   */
  const set = async (
    key: string,
    value: string | undefined | Promise<string | undefined>,
    {
      expiration = defaultExpiration,
    }: { expiration?: UniDuration | null } = {},
  ): Promise<KeyWithMetadata> => {
    assertIsValidOnDiskCacheKey({ key });
    const expiresAtMse =
      value === undefined
        ? 0 // if value was "undefined", then this key was just invalidated; mark it as invalid with the expiresAt timestamp as well
        : getMseNow() + (expiration ? toMilliseconds(expiration) : Infinity); // infinity if null

    // define the most observable format of the value; specifically, see if it is json.parseable; if so, parse it and use that, since its easier to look at in the cache file
    const awaitedValue = await value;
    const mostObservableValue = (() => {
      // if its undefined, its as observable as it gets
      if (awaitedValue === undefined) return undefined;

      // see if can json.parse
      try {
        // if we can, then return the parsed value, so when we save it it is easy to read manually
        return JSON.parse(awaitedValue);
      } catch {
        // otherwise, return the raw value, nothing more we can do
        return awaitedValue;
      }
    })();

    // save to disk
    const directoryToPersistTo = await promiseDirectoryToPersistTo;
    await saveToDisk({
      directory: directoryToPersistTo,
      key,
      value: JSON.stringify(
        {
          expiresAtMse,
          deserializedForObservability: typeof mostObservableValue !== 'string', // if its not a string, then it was deserialized by this method for observability
          value: mostObservableValue,
        },
        null,
        2,
      ),
    });

    // return the  key with metadata
    return {
      key,
      expiresAtMse,
    };
  };

  /**
   * define how to get an item from the cache
   */
  const get = async (key: string): Promise<string | undefined> => {
    assertIsValidOnDiskCacheKey({ key });
    const directoryToPersistTo = await promiseDirectoryToPersistTo;
    const cacheContentSerialized = await readFromDisk({
      directory: directoryToPersistTo,
      key,
    });
    if (!isPresent(cacheContentSerialized)) return undefined; // if not in cache, then undefined
    try {
      const cacheContent = JSON.parse(cacheContentSerialized);
      if (isRecordExpired(cacheContent)) return undefined; // if already expired, then undefined
      if (cacheContent.deserializedForObservability)
        return JSON.stringify(cacheContent.value); // if it had been deserialized for observability, reserialize it
      return cacheContent.value as string; // otherwise, its in the cache and not expired, so return the value
    } catch (error) {
      // if it was a json parsing error, warn about it and treat the key as invalid
      if (
        error instanceof Error &&
        error.message.includes('Unexpected string in JSON at position')
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          'simple-on-disk-cache: detected unparseable cache file. treating the result as invalid. this should not have occured',
          { key },
        );
        return undefined;
      }

      // otherwise, propagate the error, we dont know how to handle it
      throw error;
    }
  };

  /**
   * define how to lookup valid keys for the cache
   */
  const getValidKeysWithMetadata = async () => {
    // lookup the last saved valid keys
    const cachedValidKeysSerialized = await get(
      RESERVED_CACHE_KEY_FOR_VALID_KEYS,
    );
    const cachedValidKeys: KeyWithMetadata[] = cachedValidKeysSerialized
      ? JSON.parse(cachedValidKeysSerialized)
      : [];
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
   */
  const updateKeyWithMetadataState = async ({
    for: forKeyWithMetadata,
  }: {
    for: KeyWithMetadata;
  }) => {
    // write inside of a bottleneck, to ensure that within one machine no more than one process no more than one thread is writing to the same file; prevents corrupted key files when writing to mounted directories + prevents same-machine race conditions
    return updateKeyFileBottleneck.schedule(async () => {
      // lookup current valid keys
      const currentKeysWithMetadata = await getValidKeysWithMetadata();

      // save the keys w/ an extra key
      await set(
        RESERVED_CACHE_KEY_FOR_VALID_KEYS,
        JSON.stringify([
          // save the current keys, excluding the previous state of this key if it was there
          ...currentKeysWithMetadata.filter(
            ({ key }) => key !== forKeyWithMetadata.key, // filter out prior state for this key, if any
          ),

          // save this key, if it isn't expired
          ...(isRecordExpired(forKeyWithMetadata) ? [] : [forKeyWithMetadata]),
        ]),
        { expiration: null },
      );
    });
  };

  /**
   * define how to set an item to the cache, with valid key tracking
   */
  const setWithValidKeyTracking = async (
    ...args: Parameters<typeof set>
  ): Promise<void> => {
    // write to the cache
    const newKeyWithMetadata = await set(...args);

    // add the key as valid
    await updateKeyWithMetadataState({ for: newKeyWithMetadata });
  };

  /**
   * define how to get valid keys
   */
  const getValidKeys = async () =>
    getValidKeysWithMetadata().then((keysWithMetadata) =>
      keysWithMetadata.map(({ key }) => key),
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
   * wrap the get and set around an in memory cache, to prevent redundant disk.reads
   *
   * why?
   * - disk reads are ~15ms each
   * - memory reads are nanoseconds (1000x faster)
   * - with memory.hit before disk.hit, performance improves massively for cache.hits
   */
  const cacheInMemory = createInMemoryCache<
    string | undefined | Promise<string | undefined>
  >({
    expiration: defaultExpiration,
  });
  const getWithMemory = async (
    ...args: Parameters<typeof get>
  ): ReturnType<typeof get> => {
    // check in memory, to prevent disk hits
    const valueFoundInMemoryBefore = await cacheInMemory.get(...args);
    if (valueFoundInMemoryBefore) return valueFoundInMemoryBefore;

    // if not in memory, then .get from disk
    const valueFoundOnDisk = await getWithValidKeyTracking(...args);
    if (!valueFoundOnDisk) return undefined; // if not found on disk either, then defo undefined

    // since found on disk, set to in memory cache, for successful subsequent lookups
    await cacheInMemory.set(args[0], valueFoundOnDisk);

    // and get it from memory now, to ensure consistent output
    const valueFoundInMemoryAfter = await cacheInMemory.get(...args);
    if (!valueFoundInMemoryAfter)
      throw new UnexpectedCodePathError(
        'could not find value in memory after having been set',
      );
    return valueFoundInMemoryAfter;
  };
  const setWithMemory = async (
    ...args: Parameters<typeof set>
  ): Promise<void> => {
    // set to disk
    await setWithValidKeyTracking(...args);

    // set to memory
    await cacheInMemory.set(...args);
  };

  /**
   * return the api
   */
  return {
    set: setWithMemory,
    get: getWithMemory,
    keys: getValidKeys,
  };
};
