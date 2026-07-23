import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';
import { asMostObservableValue } from './asMostObservableValue';

/**
 * serialize a cache write into the on-disk envelope json
 *
 * .what = wraps the value in the { expiresAtMse, deserializedForObservability, value } envelope and
 *         JSON.stringifies it (2-space indent for hand-readability). the value is first cast to its
 *         most observable form; `deserializedForObservability` records whether that cast parsed it.
 * .why = centralizes the on-disk envelope write-format in one named transformer, so the set
 *        orchestrator reads as narrative and only one place knows the persisted shape.
 */
export const asSerializedEnvelope = ({
  value,
  expiresAtMse,
}: {
  value: string | undefined;
  expiresAtMse: number;
}): string => {
  const mostObservableValue = asMostObservableValue({ value });
  const envelope: CacheEnvelope = {
    expiresAtMse,
    // a non-string means asMostObservableValue parsed it for observability
    deserializedForObservability: typeof mostObservableValue !== 'string',
    value: mostObservableValue,
  };
  return JSON.stringify(envelope, null, 2);
};
