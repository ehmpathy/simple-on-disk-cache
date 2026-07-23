import { asHashSha256 } from 'hash-fns';

import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';
import { asCanonicalValue } from './asCanonicalValue';

/**
 * .what = the local disk version token for a stored envelope — the content hash of its canonical
 *         value (the etag of the bytes, computed locally)
 * .why = the token is the etag of the stored value; on the local disk we mint it ourselves as a
 *        content hash so two writes of byte-identical content share one token (mirrors the cloud
 *        disk, where s3 mints the same etag for identical content). the hash runs over the canonical
 *        value — the same string `get` returns — so a write-time and a later read-time token agree.
 */
export const asLocalVersionToken = async (
  envelope: CacheEnvelope,
): Promise<string> => asHashSha256(asCanonicalValue(envelope));
