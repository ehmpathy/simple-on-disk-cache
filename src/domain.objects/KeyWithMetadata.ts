/**
 * the shape of a tracked cache key plus the metadata the valid-keys index records for it
 *
 * .note = persisted inside the reserved valid-keys record; `expiresAtMse` lets the index drop a key
 *         once it expires without a per-key read
 * .note = expiresAtMse is `number | null` (mirrors CacheEnvelope): a no-expiry entry is written with
 *         `Infinity`, which JSON.stringify serializes to `null` — so it round-trips as `null` on the
 *         next read, which isRecordExpired reads as "never expires" (NOT as expired-at-epoch)
 */
export interface KeyWithMetadata {
  key: string;
  expiresAtMse: number | null;
}
