import type { SimpleOnDiskCacheCloudAdapter } from '../../domain.objects/SimpleOnDiskCacheCloudAdapter';
import { asCacheUri } from '../directory/asCacheUri';
import { asParsedEnvelope } from '../envelope/asParsedEnvelope';
import { asValueFromEnvelope } from '../envelope/asValueFromEnvelope';
import { getExpiresAtMseFromEnvelope } from '../envelope/getExpiresAtMseFromEnvelope';
import { warnCorruptEnvelope } from '../envelope/warnCorruptEnvelope';
import { getFromAdapter } from './cloud/getFromAdapter';
import { getFromAdapterWithMeta } from './cloud/getFromAdapterWithMeta';
import type { SourceEntry } from './SourceEntry';

/**
 * read the physical source entry for a key from the CLOUD disk in ONE read
 *
 * .what = fetches the body (+ etag when the version is wanted), parses the envelope once, then derives
 *         the expiry + value from that single parse. null = physically absent.
 * .why = the cloud-tier half of getSourceEntry — the version IS the server-minted etag, carried via the
 *        meta read. a plain get (include.version false) uses the meta-free getFromAdapter, so a custom
 *        adapter that ignores include.meta still serves plain reads.
 */
export const getCloudSourceEntry = async ({
  adapter,
  path,
  key,
  include,
}: {
  adapter: SimpleOnDiskCacheCloudAdapter;
  path: string;
  key: string;
  include: { version: boolean };
}): Promise<SourceEntry | null> => {
  const uri = asCacheUri({ path, key });

  // read the body (+ etag when the version is wanted). a plain get uses the meta-free
  // getFromAdapter, so a custom adapter that ignores include.meta still serves plain reads; a
  // conditional op uses getFromAdapterWithMeta to carry the server etag as the version.
  const fetched = include.version
    ? await getFromAdapterWithMeta({ adapter, uri })
    : await getFromAdapter({ adapter, uri }).then((body) =>
        body === null ? null : { body, etag: undefined },
      );
  if (fetched === null) return null;
  const envelope = asParsedEnvelope(fetched.body); // one parse, reused for expiry + value
  if (envelope === null) warnCorruptEnvelope({ key }); // consistent with the local + get() paths
  // .note = a corrupt cloud envelope deliberately does NOT collapse to null the way the local branch
  //         does. instead it returns the real etag with expiresAtMse:0 (getExpiresAtMseFromEnvelope of
  //         null) so it reads as logically-expired-but-present. .why = the cloud reclaim of a corrupt
  //         object is a compare-and-set on its CURRENT etag (there is no local lock to rewrite under),
  //         so the etag must survive the corrupt read for the reclaim to have a version to CAS against.
  //         the local branch returns null because its reclaim rewrites under the per-key lock, which
  //         needs no etag. do NOT "simplify" this to mirror the local null-return — it would break the
  //         cloud corrupt-reclaim path.
  return {
    version: fetched.etag,
    expiresAtMse: getExpiresAtMseFromEnvelope(envelope),
    value: envelope === null ? undefined : asValueFromEnvelope(envelope),
  };
};
