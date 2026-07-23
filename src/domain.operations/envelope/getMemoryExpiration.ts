import { getMseNow } from '../../utils/getMseNow';

/**
 * compute the in-memory cache expiration from the disk's absolute expiry timestamp
 *
 * .what = the memory tier must expire at the SAME absolute time as the disk tier, so its
 *         expiration is the time left until the disk's expiresAtMse — clamped at 0 (never negative)
 * .why = the disk write may take a while (e.g. s3 latency), so a relative "expire in N ms" computed
 *        at memory-write time would drift past the disk's expiry. the time-left form pins both tiers
 *        to one absolute expiry. a non-positive remainder means "already expired" → 0 (immediate).
 * .note = expiresAtMse is `number | null` (mirrors the persisted shape): null = a no-expiry entry
 *         (Infinity round-tripped through JSON), so the memory copy must also never expire → Infinity.
 */
export const getMemoryExpiration = ({
  expiresAtMse,
}: {
  expiresAtMse: number | null;
}): { milliseconds: number } => {
  // a no-expiry entry → the memory copy never expires either
  if (expiresAtMse === null) return { milliseconds: Infinity };

  // the time left until the disk's absolute expiry, never negative
  const expiresAtMseLeft = expiresAtMse - getMseNow();
  return { milliseconds: expiresAtMseLeft > 0 ? expiresAtMseLeft : 0 };
};
