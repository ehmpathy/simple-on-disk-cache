/**
 * .what = the read consistency policy for the cache
 * .why =
 * - source-first: read the source store every time; always reflects the latest write, cross-process overwrites included (correct)
 * - memory-first: an in-process memory hit short-circuits the source read; fast, but can serve a stale value after a cross-process overwrite (single-writer usecases)
 */
export type SimpleOnDiskCacheConsistency = 'source-first' | 'memory-first';
