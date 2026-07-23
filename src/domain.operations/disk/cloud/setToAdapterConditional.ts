import { UnexpectedCodePathError } from 'helpful-errors';

import type { SimpleOnDiskCacheCloudAdapter } from '../../../domain.objects/SimpleOnDiskCacheCloudAdapter';

/**
 * invoke the adapter's conditional set, and fail loud when the adapter did not honor the condition
 *
 * .what = a conditional cloud-disk write with `include: { meta: true }`, then asserts the adapter
 *         returned the written object's version token (etag)
 * .why = fail-loud symmetry with getFromAdapterWithMeta. an adapter that structurally satisfies
 *        SimpleOnDiskCacheCloudAdapter but does not actually enforce `condition` (a partial or
 *        hand-rolled adapter) would silently downgrade a conditional write to last-writer-wins —
 *        the exact lost-update this feature exists to prevent, with no error and no log. an adapter
 *        that honors conditional writes (the shipped sdk-aws-s3) returns meta.etag when asked; one
 *        that ignores conditional semantics returns void, so a demand for the etag turns a silent
 *        downgrade into a loud UnexpectedCodePathError — no non-conformant adapter passes undetected
 */
export const setToAdapterConditional = async ({
  adapter,
  uri,
  body,
  condition,
}: {
  adapter: SimpleOnDiskCacheCloudAdapter;
  uri: string;
  body: string;
  condition: { etag: string | null };
}): Promise<void> => {
  const result = await adapter.set({
    uri,
    body,
    condition,
    include: { meta: true },
  });
  if (!result || typeof result.meta?.etag !== 'string')
    // multi-line message (one sentence per line, `to fix:` cue) to match the local-lock
    // fail-loud convention in withLocalKeyLock.ts; single-`\n`-joined so a `.split('\n\n')[0]`
    // snapshot pins the full guidance while the metadata dump stays out
    throw new UnexpectedCodePathError(
      [
        `cloud adapter ignored include.meta on a conditional set — cannot confirm the condition was enforced.`,
        `a non-conformant adapter that drops include.meta may silently downgrade a conditional write to last-writer-wins — the exact lost-update this guard prevents.`,
        `to fix: use a cloud adapter that honors include.meta (e.g. the shipped sdk-aws-s3), which returns the written object's etag.`,
      ].join('\n'),
      { uri },
    );
};
