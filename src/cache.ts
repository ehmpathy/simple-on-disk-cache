/* eslint-disable no-return-await */
import { promises as fs } from 'fs';
import { withNot } from 'type-fns';
import { UnexpectedCodePathError } from './utils/errors/UnexpectedCodePathError';
import { s3 } from './utils/s3';

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
    options?: { secondsUntilExpiration?: number },
  ) => Promise<void>;

  /**
   * list all valid keys in cache
   */
  keys: () => Promise<string[]>;
}

export class InvalidOnDiskCacheKeyError extends Error {
  constructor({ key }: { key: string }) {
    super(
      `
The on-disk cache key requested is invalid: '${key}'. Only alphanumeric characters and period, dash, and underscore are allowed.
    `.trim(),
    );
  }
}
const assertIsValidOnDiskCacheKey = ({ key }: { key: string }) => {
  const isValid = /^[a-zA-Z0-9.\-_]+$/.test(key); // only allow those characters, to ensure its safe for disk file name
  if (!isValid) throw new InvalidOnDiskCacheKeyError({ key });
};

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
 * create a simple on-disk cache
 */
export const createCache = ({
  directoryToPersistTo,
  defaultSecondsUntilExpiration = 5 * 60,
}: {
  directoryToPersistTo: DirectoryToPersistTo;
  defaultSecondsUntilExpiration?: number;
}): SimpleOnDiskCache => {
  /**
   * define how to set an item into the cache
   */
  const set = async (
    key: string,
    value: string | undefined | Promise<string | undefined>,
    {
      secondsUntilExpiration = defaultSecondsUntilExpiration,
    }: { secondsUntilExpiration?: number } = {},
  ): Promise<KeyWithMetadata> => {
    assertIsValidOnDiskCacheKey({ key });
    const expiresAtMse =
      value === undefined
        ? 0 // if value was "undefined", then this key was just invalidated; mark it as invalid with the expiresAt timestamp as well
        : getMseNow() + secondsUntilExpiration * 1000;

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
    const cacheContentSerialized = await readFromDisk({
      directory: directoryToPersistTo,
      key,
    });
    if (cacheContentSerialized === undefined) return undefined; // if not in cache, then undefined
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
      { secondsUntilExpiration: Infinity },
    );
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
   * return the api
   */
  return {
    set: setWithValidKeyTracking,
    get: getWithValidKeyTracking,
    keys: getValidKeys,
  };
};
