import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';

import { asErrorCode } from '../../../error/asErrorCode';
import { delTolerantOfAbsent } from '../delTolerantOfAbsent';

/**
 * gen (acquire-if-absent) an exclusive lock file atomically; returns false when it already exists
 *
 * .what = the atomic lock-file-acquisition primitive — two concurrent acquirers, exactly one wins.
 *         its ONLY caller is withLocalKeyLock's acquire(), which uses it to create the per-key
 *         `#lock` file, NOT the cache value file. the value put-if-absent is a separate discipline:
 *         acquire the lock via this, then read-check-write the value under it (setToLocalConditional).
 * .why = writes to a temp file first, then `link`s it into place. link is atomic and fails
 *        with EEXIST when the target exists, so the published lock file is always fully-written —
 *        a racer that loses never observes a half-written file (which a bare O_EXCL create,
 *        empty between open + write, would expose).
 */
export const genLockExclusive = async ({
  path,
  value,
}: {
  path: string;
  value: string;
}): Promise<boolean> => {
  const tempPath = `${path}.tmp.${randomUUID()}`;
  await fs.writeFile(tempPath, value, { flag: 'w', encoding: 'utf-8' });
  try {
    await fs.link(tempPath, path); // atomic create-if-absent (EEXIST when present)
    return true;
  } catch (error) {
    // .note = read .code via a typed accessor (no `instanceof Error` guard) — the same pattern
    //         getSourceEntry uses; under the jest/swc realm, fs rejections can fail instanceof
    if (asErrorCode(error) === 'EEXIST') return false;
    throw error;
  } finally {
    await delTolerantOfAbsent(tempPath); // clean up the temp; tolerate only an absent target
  }
};
