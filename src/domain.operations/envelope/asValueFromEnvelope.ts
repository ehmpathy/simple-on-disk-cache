import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';

/**
 * derive the string value a cache read returns from an envelope — the ONE owner of the
 * "deserialized-for-observability → reserialize, else pass the string through" rule
 *
 * .what = deserialized-for-observability values are reserialized via JSON.stringify; a plain
 *         string value passes through; a tombstone (value undefined) or a non-string yields
 *         undefined (logically no value)
 * .why = both `get()` (the public read) and `asCanonicalValue` (the content-hash input) MUST
 *        derive the value identically — the content-hash token's core invariant (assumption #5:
 *        a write-time and a later read-time hash of the same logical value always agree) depends
 *        on it. one implementation removes the prior comment-enforced mirror that could silently
 *        drift if `get`'s branch changed.
 */
export const asValueFromEnvelope = (
  envelope: CacheEnvelope,
): string | undefined => {
  if (envelope.value === undefined) return undefined; // tombstone → no value
  if (envelope.deserializedForObservability)
    return JSON.stringify(envelope.value); // reserialize the observability-parsed value
  return typeof envelope.value === 'string' ? envelope.value : undefined;
};
