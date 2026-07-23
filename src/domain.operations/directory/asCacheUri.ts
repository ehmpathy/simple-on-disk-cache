/**
 * cast a disk path and key to a cache URI
 *
 * .what = combines base path and key with consistent `/` separator
 * .why = handles paths with or without terminal slash; shared by both the local and cloud disk
 */
export const asCacheUri = ({
  path,
  key,
}: {
  path: string;
  key: string;
}): string => {
  const basePath = path.replace(/\/$/, ''); // strip terminal slash if present
  return [basePath, key].join('/');
};
