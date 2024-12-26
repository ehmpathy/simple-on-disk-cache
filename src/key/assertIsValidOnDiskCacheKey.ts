export class InvalidOnDiskCacheKeyError extends Error {
  constructor({ key }: { key: string }) {
    super(
      `
The on-disk cache key requested is invalid: '${key}'. Only alphanumeric characters and period, dash, and underscore are allowed.
    `.trim(),
    );
  }
}
export const assertIsValidOnDiskCacheKey = ({ key }: { key: string }): void => {
  const isValid = /^[a-zA-Z0-9.\-_]+$/.test(key); // only allow those characters, to ensure its safe for disk file name
  if (!isValid) throw new InvalidOnDiskCacheKeyError({ key });
};
