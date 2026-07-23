import { type IsoDuration, toMilliseconds } from 'iso-time';

import { getMseNow } from '../../utils/getMseNow';

/**
 * compute the expiry timestamp (ms since epoch) for a cache write
 *
 * .what = a tombstone write (value undefined) expires at 0 (immediately invalid); a real write
 *         expires at now + the expiration duration, or never (Infinity) when expiration is null.
 * .why = centralizes the write-time expiry rule so the set orchestrator reads as narrative. the
 *        value must be the RESOLVED (awaited) value — a promise that resolves to undefined is a
 *        tombstone too, so the caller awaits before this runs (else async invalidation would write
 *        a future-dated tombstone that blocks a later put-if-absent).
 */
export const getExpiresAtMse = ({
  value,
  expiration,
}: {
  value: string | undefined;
  expiration: IsoDuration | null;
}): number => {
  // a tombstone (value undefined) was just invalidated; mark it expired at epoch 0
  if (value === undefined) return 0;

  // otherwise expire at now + the duration, or never (Infinity) when expiration is null
  return getMseNow() + (expiration ? toMilliseconds(expiration) : Infinity);
};
