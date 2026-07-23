import type { SimpleOnDiskCacheCloudAdapter } from './SimpleOnDiskCacheCloudAdapter';

/**
 * the directory to persist your cache to can be either a local disk or a cloud disk
 */
export type DirectoryToPersistTo =
  | { local: { path: string } }
  | { cloud: { path: string; via: SimpleOnDiskCacheCloudAdapter } };
