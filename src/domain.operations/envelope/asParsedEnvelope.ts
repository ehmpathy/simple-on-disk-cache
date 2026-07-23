import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';
import { isCorruptEnvelopeError } from './isCorruptEnvelopeError';

/**
 * parse a raw cache envelope string into its object form, or null when the file is corrupt
 *
 * .what = the one canonical envelope reader — both the plain `get` path and the conditional
 *         source reads route through it, so corrupt-file tolerance stays consistent in one place
 * .why = a partially-written or truncated envelope must read as a cache miss, not a crash — one
 *        reader means every caller treats a corrupt file the same way, with no divergent handler
 * .note = a corrupt envelope reads as null (logically absent); any non-parse error fails loud
 */
export const asParsedEnvelope = (raw: string): CacheEnvelope | null => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (isCorruptEnvelopeError(error)) return null; // corrupt → logically absent
    throw error; // an unknown error is a real defect — fail loud
  }
};
