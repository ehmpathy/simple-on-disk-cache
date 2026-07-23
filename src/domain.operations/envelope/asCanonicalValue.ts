import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';
import { asValueFromEnvelope } from './asValueFromEnvelope';

/**
 * derive the canonical value string an envelope yields on `get` — the stable content the local disk
 * version token hashes
 *
 * .what = the same value `get` returns (via the shared asValueFromEnvelope), with a tombstone or
 *         absent value collapsed to an empty sentinel so it always hashes to a fixed token.
 * .why = the token must be the etag of the CONTENT, not of the stored bytes (which embed a
 *        per-write wall-clock expiresAtMse). a hash of the canonical value — the same string
 *        `get` returns — makes the token stable across two writes of identical content (vision
 *        assumption #1, a mirror of s3's content etag) and guarantees a write-time and a later
 *        read-time token of the same logical value always agree (assumption #5).
 */
export const asCanonicalValue = (envelope: CacheEnvelope): string =>
  asValueFromEnvelope(envelope) ?? ''; // tombstone/absent → empty sentinel for the content hash
