import type { KeyWithMetadata } from '../../domain.objects/KeyWithMetadata';

/**
 * serialize the valid-keys list into the string form stored on the reserved record
 *
 * .what = encodes a KeyWithMetadata[] into the json string persisted under the reserved valid-keys key
 * .why = keeps the valid-keys write orchestrator narrative — the raw JSON.stringify decode-friction
 *        lives behind one domain-named cast, the twin of asParsedValidKeys
 */
export const asSerializedValidKeys = (keys: KeyWithMetadata[]): string =>
  JSON.stringify(keys);
