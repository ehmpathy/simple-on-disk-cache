import type { DirectoryToPersistTo } from '../../domain.objects/DirectoryToPersistTo';
import type { SimpleCacheCondition } from '../../domain.objects/SimpleCacheCondition';
import { asCacheUri } from '../directory/asCacheUri';
import { isCloudDirectory } from '../directory/isCloudDirectory';
import { isLocalDirectory } from '../directory/isLocalDirectory';
import { throwDirectoryUnsupported } from '../directory/throwDirectoryUnsupported';
import { setToCloudConditional } from './cloud/setToCloudConditional';
import { setToLocalConditional } from './local/setToLocalConditional';

/**
 * write a value with a version precondition; throws SimpleCacheConditionError on a miss
 *
 * .what = put-if-absent (condition.version === null) or compare-and-set (token), atomic where
 *         the backend allows: an O_EXCL-lock read-check-write on the local disk, the supplier's
 *         native conditional write on the cloud disk
 * .why = honors logical expiry — a put-if-absent reclaims a physically-present-but-expired entry
 */
export const setToDiskConditional = async ({
  directory,
  key,
  value,
  condition,
}: {
  directory: DirectoryToPersistTo;
  key: string;
  value: string;
  condition: SimpleCacheCondition;
}): Promise<void> => {
  if (isLocalDirectory(directory))
    return setToLocalConditional({
      directory,
      localPath: asCacheUri({ path: directory.local.path, key }),
      key,
      value,
      condition,
    });
  if (isCloudDirectory(directory))
    return setToCloudConditional({
      directory,
      adapter: directory.cloud.via,
      uri: asCacheUri({ path: directory.cloud.path, key }),
      key,
      value,
      condition,
    });
  return throwDirectoryUnsupported(directory);
};
