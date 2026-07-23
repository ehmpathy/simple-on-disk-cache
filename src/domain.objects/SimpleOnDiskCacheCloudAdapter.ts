/**
 * adapter for cloud-disk storage backends
 *
 * .what = interface for storage SDKs that understand URI paths
 * .why = enables symmetric `{ path, via }` config for any cloud-disk provider
 */
export type SimpleOnDiskCacheCloudAdapter = {
  /**
   * get a value by URI
   *
   * supports both:
   * - `get: { one: (input) => ... }` (namespace style, e.g., sdkAwsS3)
   * - `get: (input) => ...` (direct function style)
   *
   * with `include: { meta: true }`, returns the value alongside its opaque version token
   * (etag) — used by `version(key)` and the conditional-write paths
   *
   * @returns the value as a string, or null if not found (must NOT throw on not-found)
   */
  get:
    | {
        one: (input: {
          uri: string;
          include?: { meta: true };
        }) => Promise<string | null | { body: string; meta: { etag: string } }>;
      }
    | ((input: {
        uri: string;
        include?: { meta: true };
      }) => Promise<string | null | { body: string; meta: { etag: string } }>);

  /**
   * set a value by URI
   *
   * with `condition: { etag }`, performs an atomic conditional write:
   * - etag: null    → put-if-absent (write only if the object is absent)
   * - etag: <token> → compare-and-set (write only if the current etag matches)
   *
   * on a precondition miss, a custom adapter MUST throw `SimpleCacheConditionError` (exported from
   * this package) — the cache propagates it unchanged, so consumers see one error contract across
   * every tier. the shipped sdk-aws-s3 throws its own S3PreconditionFailedError /
   * S3ConditionalConflictError, which the cache translates as a built-in convenience; any other
   * adapter's bespoke error would NOT be recognized, so throw SimpleCacheConditionError directly.
   *
   * with `include: { meta: true }`, returns the written object's version token (etag). the cache
   * always requests this on a conditional write and fails loud if it is absent — an adapter that
   * silently ignores `condition` cannot pass as a conditional-write backend.
   */
  set: (input: {
    uri: string;
    body: string;
    condition?: { etag: string | null };
    include?: { meta: true };
  }) => Promise<void | { meta: { etag: string } }>;
};
