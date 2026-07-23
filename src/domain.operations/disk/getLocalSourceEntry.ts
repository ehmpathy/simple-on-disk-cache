import { promises as fs } from 'fs';

import { asCacheUri } from '../directory/asCacheUri';
import { asLocalVersionToken } from '../envelope/asLocalVersionToken';
import { asParsedEnvelope } from '../envelope/asParsedEnvelope';
import { asValueFromEnvelope } from '../envelope/asValueFromEnvelope';
import { getExpiresAtMseFromEnvelope } from '../envelope/getExpiresAtMseFromEnvelope';
import { warnCorruptEnvelope } from '../envelope/warnCorruptEnvelope';
import { asErrorCode } from '../error/asErrorCode';
import type { SourceEntry } from './SourceEntry';

/**
 * read the physical source entry for a key from the LOCAL disk in ONE read
 *
 * .what = reads + parses the envelope once, then derives the version (only when asked), the expiry, and
 *         the value from that single parse. null = physically absent (ENOENT) or corrupt.
 * .why = the local-tier half of getSourceEntry — the content-hash version is derived from the value via
 *        asLocalVersionToken, and skipped entirely for a plain get (include.version false), so a plain
 *        read pays no hash cost.
 */
export const getLocalSourceEntry = async ({
  path,
  key,
  include,
}: {
  path: string;
  key: string;
  include: { version: boolean };
}): Promise<SourceEntry | null> => {
  const raw = await fs
    .readFile(asCacheUri({ path, key }), { encoding: 'utf-8' })
    .catch((error) => {
      if (asErrorCode(error) === 'ENOENT') return null; // never cached
      throw error;
    });
  if (raw === null) return null;
  const envelope = asParsedEnvelope(raw); // one parse, reused for version + expiry + value
  if (envelope === null) {
    warnCorruptEnvelope({ key }); // surface the corrupt file on EVERY read path, not just get()
    return null; // corrupt → logically absent
  }
  return {
    // derive the content-hash version only when asked; a plain get (version: false) skips the hash
    version: include.version ? await asLocalVersionToken(envelope) : undefined,
    expiresAtMse: getExpiresAtMseFromEnvelope(envelope),
    value: asValueFromEnvelope(envelope),
  };
};
