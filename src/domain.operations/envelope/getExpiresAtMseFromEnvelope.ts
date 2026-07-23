import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';

/**
 * .what = the logical-presence expiry of an already-parsed cache envelope
 * .why = conditional ops decide logical presence off the source envelope; this reads the expiry
 *        from the parsed envelope so a caller that already parsed the raw bytes does NOT re-parse.
 * .note = returns `number | null`:
 *         - a corrupt/absent envelope (null) → 0 (expired-at-epoch → counts as absent)
 *         - a no-expiry entry → null (serialized from Infinity; isRecordExpired reads null as
 *           "never expires" — must NOT be folded to 0, or a no-expiry key would falsely read as
 *           expired/absent, and a put-if-absent could then clobber it)
 *         - otherwise → the stored numeric timestamp
 */
export const getExpiresAtMseFromEnvelope = (
  envelope: CacheEnvelope | null,
): number | null => {
  if (envelope === null) return 0; // corrupt/absent → expired → absent
  if (envelope.expiresAtMse === null) return null; // no-expiry entry → never expires
  return typeof envelope.expiresAtMse === 'number' ? envelope.expiresAtMse : 0;
};
