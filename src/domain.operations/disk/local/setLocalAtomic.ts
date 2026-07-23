import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';

import { delTolerantOfAbsent } from './delTolerantOfAbsent';

/**
 * write a value to a local-disk path atomically — via a temp file + rename
 *
 * .what = writes the value to a sibling temp file, then renames it into place
 * .why = fs.writeFile(flag:'w') truncates then writes, so a concurrent lock-free reader could
 *        observe a torn (half-written) file mid-write and misread it as absent or corrupt. fs.rename
 *        is atomic on the same filesystem, so the published file flips from the old complete content
 *        to the new complete content in one step — a reader sees one or the other, never a mix. this
 *        removes the torn-read race without a read-side lock (which would tax every read). writers
 *        still serialize under withLocalKeyLock; this only makes each write's publish step atomic.
 * .note = the temp uses a `.tmp.<uuid>` suffix — un-representable as a cache key (keys match
 *         /^[a-zA-Z0-9.\-_]+$/), so it never shadows a real cache file; cleaned up on a rename fault.
 */
export const setLocalAtomic = async ({
  path: localPath,
  value,
}: {
  path: string;
  value: string;
}): Promise<void> => {
  const tempPath = `${localPath}.tmp.${randomUUID()}`;
  await fs.writeFile(tempPath, value, { flag: 'w', encoding: 'utf-8' });
  try {
    await fs.rename(tempPath, localPath); // atomic publish
  } catch (error) {
    await delTolerantOfAbsent(tempPath); // clean up the temp on a rename fault
    throw error;
  }
};
