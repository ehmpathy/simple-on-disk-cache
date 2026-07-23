import type { DirectoryToPersistTo } from '../../domain.objects/DirectoryToPersistTo';

/**
 * narrow a directory to the local-disk variant (the machine filesystem)
 */
export const isLocalDirectory = (
  directory: DirectoryToPersistTo,
): directory is { local: { path: string } } => 'local' in directory; // discriminated union — the `local` key narrows to the local variant
