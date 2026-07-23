import { UnexpectedCodePathError } from 'helpful-errors';

import type { SimpleOnDiskCacheCloudAdapter } from '../../../domain.objects/SimpleOnDiskCacheCloudAdapter';
import { getFromAdapterRaw } from './getFromAdapterRaw';

/**
 * invoke the adapter's get for both the value string and its opaque version token (etag)
 *
 * @returns { body, etag } when present, or null when absent
 */
export const getFromAdapterWithMeta = async ({
  adapter,
  uri,
}: {
  adapter: SimpleOnDiskCacheCloudAdapter;
  uri: string;
}): Promise<{ body: string; etag: string } | null> => {
  const result = await getFromAdapterRaw({
    adapter,
    uri,
    include: { meta: true },
  });
  if (result === null) return null;
  if (typeof result === 'string')
    // multi-line message (one sentence per line, `to fix:` cue) to match the local-lock
    // fail-loud convention in withLocalKeyLock.ts; single-`\n`-joined so a `.split('\n\n')[0]`
    // snapshot pins the full guidance while the metadata dump stays out
    throw new UnexpectedCodePathError(
      [
        `cloud adapter ignored include.meta — cannot read the version token for the conditional operation.`,
        `this happens only with a non-conformant cloud adapter that drops the include.meta request.`,
        `to fix: use a cloud adapter that honors include.meta (e.g. the shipped sdk-aws-s3), which returns the object's etag.`,
      ].join('\n'),
      { uri },
    );
  return { body: result.body, etag: result.meta.etag };
};
