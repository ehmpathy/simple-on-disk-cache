/**
 * the shape of a stored cache envelope — the json blob every cache file persists
 *
 * .note = expiresAtMse is `number | null`: a no-expiry entry is written with `Infinity`, which
 *         JSON.stringify serializes to `null` — so on read it round-trips as `null`, which
 *         isRecordExpired reads as "never expires" (NOT as expired-at-epoch)
 */
export interface CacheEnvelope {
  expiresAtMse: number | null;
  deserializedForObservability?: boolean;
  value: unknown;
}
