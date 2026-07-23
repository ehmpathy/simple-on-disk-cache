import type { SimpleOnDiskCacheCloudAdapter } from '../../../domain.objects/SimpleOnDiskCacheCloudAdapter';
import { getFromAdapterRaw } from './getFromAdapterRaw';

/**
 * invoke the adapter's get for the plain value string (drops any meta)
 *
 * .what = returns just the stored body string (or null when absent), which narrows the raw
 *         value-or-value+meta union that getFromAdapterRaw can return down to the body alone
 * .why = the plain (non-conditional) cloud read wants only the body — the etag/meta matters solely
 *        to the version/conditional paths, so this narrows the surface for every plain get
 */
export const getFromAdapter = async ({
  adapter,
  uri,
}: {
  adapter: SimpleOnDiskCacheCloudAdapter;
  uri: string;
}): Promise<string | null> => {
  const result = await getFromAdapterRaw({ adapter, uri });
  if (result === null) return null;
  return typeof result === 'string' ? result : result.body;
};
