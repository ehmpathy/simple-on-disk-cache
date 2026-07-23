import type { KeyWithMetadata } from '../../domain.objects/KeyWithMetadata';

/**
 * project the valid-keys metadata list down to its bare key names
 *
 * .what = maps a KeyWithMetadata[] to the string[] of just the key names
 * .why = keeps the keys() orchestrator pure narrative — the inline .map projection lives behind one
 *        domain-named cast, so the caller reads "the keys list", not a primitive transform
 */
export const asKeysList = (keys: KeyWithMetadata[]): string[] =>
  keys.map(({ key }) => key);
