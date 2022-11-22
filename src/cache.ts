/* eslint-disable no-return-await */
import { promises as fs } from 'fs';

import { UnexpectedCodePathError } from './utils/errors/UnexpectedCodePathError';
import { s3 } from './utils/s3';

export interface SimpleOnDiskCache {
  get: (key: string) => Promise<string | undefined>;
  set: (
    key: string,
    value: string | Promise<string>,
    options?: { secondsUntilExpiration?: number },
  ) => Promise<void>;
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

export const createCache = ({
  directoryToPersistTo,
  defaultSecondsUntilExpiration = 5 * 60,
}: {
  directoryToPersistTo: DirectoryToPersistTo;
  defaultSecondsUntilExpiration?: number;
}): SimpleOnDiskCache => {
  // define how to set an item into the cache
  const set = async (
    key: string,
    value: string | Promise<string>,
    {
      secondsUntilExpiration = defaultSecondsUntilExpiration,
    }: { secondsUntilExpiration?: number } = {},
  ): Promise<void> => {
    assertIsValidOnDiskCacheKey({ key });
    const expiresAtMse = getMseNow() + secondsUntilExpiration * 1000;

    // define the most observable format of the value; specifically, see if it is json.parseable; if so, parse it and use that, since its easier to look at in the cache file
    const awaitedValue = await value;
    const mostObservableValue = (() => {
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
  };

  // define how to get an item from the cache
  const get = async (key: string): Promise<string | undefined> => {
    assertIsValidOnDiskCacheKey({ key });
    const cacheContentSerialized = await readFromDisk({
      directory: directoryToPersistTo,
      key,
    });
    if (cacheContentSerialized === undefined) return undefined; // if not in cache, then undefined
    const cacheContent = JSON.parse(cacheContentSerialized);
    if (cacheContent.expiresAtMse < getMseNow()) return undefined; // if already expired, then undefined
    if (cacheContent.deserializedForObservability)
      return JSON.stringify(cacheContent.value); // if it had been deserialized for observability, reserialize it
    return cacheContent.value as string; // otherwise, its in the cache and not expired, so return the value
  };

  // return the api
  return { set, get };
};
