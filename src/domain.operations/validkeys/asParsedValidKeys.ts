import type { KeyWithMetadata } from '../../domain.objects/KeyWithMetadata';

/**
 * parse the serialized valid-keys record into its typed list form
 *
 * .what = decodes the reserved valid-keys record's json string into a KeyWithMetadata[] (an empty
 *         list when the record is absent)
 * .why = keeps the valid-keys read orchestrator narrative — the raw JSON.parse decode-friction lives
 *        behind one domain-named cast, so the caller reads "parse the valid keys", not a primitive
 */
export const asParsedValidKeys = (
  raw: string | undefined,
): KeyWithMetadata[] => (raw ? JSON.parse(raw) : []);
