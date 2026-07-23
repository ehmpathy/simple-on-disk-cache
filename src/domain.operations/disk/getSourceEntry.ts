import type { DirectoryToPersistTo } from '../../domain.objects/DirectoryToPersistTo';
import { isCloudDirectory } from '../directory/isCloudDirectory';
import { isLocalDirectory } from '../directory/isLocalDirectory';
import { throwDirectoryUnsupported } from '../directory/throwDirectoryUnsupported';
import { getCloudSourceEntry } from './getCloudSourceEntry';
import { getLocalSourceEntry } from './getLocalSourceEntry';
import type { SourceEntry } from './SourceEntry';

/**
 * the physical source entry for a key: opaque version + expiry + the stored value
 *
 * .what = dispatches to the local- or cloud-tier reader, which reads the source store directly (past
 *         any memory tier) in ONE read — so conditional ops always see the true cross-process state
 *         and can gate on the version AND return the value from the SAME physical read (no
 *         check-then-read TOCTOU). `include.version` selects whether to derive the version: conditional
 *         ops need it (default true); a plain get does not, so `version: false` skips the cost — no
 *         content hash on the local disk, no `include.meta` demand on the cloud adapter.
 * .why = a thin dispatcher over getLocalSourceEntry / getCloudSourceEntry, a mirror of the
 *        setToDisk / setToDiskConditional split — each tier owns its read + version derivation, this
 *        owns only the tier choice, so one parse/expiry pipeline serves plain + conditional reads.
 */
export const getSourceEntry = async ({
  directory,
  key,
  include = { version: true },
}: {
  directory: DirectoryToPersistTo;
  key: string;
  include?: { version?: boolean };
}): Promise<SourceEntry | null> => {
  const version = include.version ?? true; // default: derive the version (the conditional read path)
  if (isLocalDirectory(directory))
    return getLocalSourceEntry({
      path: directory.local.path,
      key,
      include: { version },
    });
  if (isCloudDirectory(directory))
    return getCloudSourceEntry({
      adapter: directory.cloud.via,
      path: directory.cloud.path,
      key,
      include: { version },
    });
  return throwDirectoryUnsupported(directory);
};
