import type { SimpleOnDiskCacheCloudAdapter } from '../../../domain.objects/SimpleOnDiskCacheCloudAdapter';

/**
 * invoke the adapter's get method, dispatches to either namespace or direct function style
 *
 * .what = calls whichever get shape the cloud adapter exposes (the `get.one` namespace or the
 *         bare `get` function) and returns its raw result — the plain value string, or the
 *         value+meta union when `include: { meta: true }` asks for the etag, or null when absent
 * .why = the cloud adapter contract permits two get shapes; this one seam absorbs that fork so
 *        every cloud read (the plain read via getFromAdapter, the version read via the conditional
 *        paths) speaks to one uniform call and the union only widens when meta is explicitly asked for
 */
export const getFromAdapterRaw = async ({
  adapter,
  uri,
  include,
}: {
  adapter: SimpleOnDiskCacheCloudAdapter;
  uri: string;
  include?: { meta: true };
}): Promise<string | null | { body: string; meta: { etag: string } }> => {
  if (typeof adapter.get === 'function') return adapter.get({ uri, include });
  return adapter.get.one({ uri, include });
};
