/**
 * a version precondition for a conditional cache operation — usable on both get and set
 *
 * - version: null      → "must be absent" (put-if-absent)
 * - version: '<token>' → "must match the current version" (compare-and-set)
 *
 * note
 * - the version token is opaque; treat it as an equality-only value, never parse or order it
 * - this mirrors `SimpleCacheCondition` from with-simple-cache exactly. it is redefined here
 *   (not imported) to keep this package's PUBLIC types self-contained: with-simple-cache is
 *   only a devDependency + optional peerDependency (it depends on this package at runtime, so a
 *   real dependency on it would form a manifest cycle). a bare `import type` is erased at
 *   compile, so it forms no runtime edge — but it WOULD leak a `with-simple-cache` reference
 *   into this package's shipped `.d.ts`, which breaks a standalone consumer who never installed
 *   it. the local redefinition keeps the emitted types dependency-free. a consumer proves
 *   `WithCacheConditionals` structurally on their side.
 */
export type SimpleCacheCondition = { version: string | null };
