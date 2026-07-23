import type { DirectoryToPersistTo } from '../../domain.objects/DirectoryToPersistTo';
import type { SimpleOnDiskCacheCloudAdapter } from '../../domain.objects/SimpleOnDiskCacheCloudAdapter';

/**
 * narrow a directory to the cloud-disk variant (a remote object store, e.g. s3)
 */
export const isCloudDirectory = (
  directory: DirectoryToPersistTo,
): directory is {
  cloud: { path: string; via: SimpleOnDiskCacheCloudAdapter };
} => 'cloud' in directory; // discriminated union — the `cloud` key narrows to the cloud variant
