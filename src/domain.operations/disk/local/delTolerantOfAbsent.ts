import { promises as fs } from 'fs';

import { asErrorCode } from '../../error/asErrorCode';

/**
 * unlink a file, tolerant only of an absent target (ENOENT); rethrow every other error
 *
 * .why = cleanup of a temp/lock file must not failhide real fs errors (permissions, disk full);
 *        an absent file is the one benign outcome (a race already removed it), so we allowlist
 *        exactly ENOENT and fail loud on the rest
 */
export const delTolerantOfAbsent = async (path: string): Promise<void> => {
  await fs.unlink(path).catch((error) => {
    if (asErrorCode(error) === 'ENOENT') return; // already gone — fine
    throw error;
  });
};
