import { UnexpectedCodePathError } from 'helpful-errors';

import type { DirectoryToPersistTo } from '../../domain.objects/DirectoryToPersistTo';

/**
 * fail loud when a directory is neither a local nor a cloud disk — the shared exhaustive-else
 *
 * .why = every tier-dispatch (`if local … if cloud …`) ends in this same guard; one helper keeps
 *        the message + metadata consistent and adds a tier without an edit at 4+ call sites
 */
export const throwDirectoryUnsupported = (
  directory: DirectoryToPersistTo,
): never => {
  throw new UnexpectedCodePathError(
    'directory was neither local or cloud. unsupported',
    { directory },
  );
};
