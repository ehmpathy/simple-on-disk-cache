import type { KeyWithMetadata } from '../../domain.objects/KeyWithMetadata';
import { isRecordExpired } from './isRecordExpired';

/**
 * upsert one key's metadata into the valid-keys list (pure)
 *
 * .what = returns the current valid-keys list with `forKeyWithMetadata`'s prior entry removed and,
 *         unless it is expired, its fresh entry appended — an expired record is dropped (invalidation)
 * .why = the valid-keys write is a read-modify-write; this pure transformer owns the "modify" step so
 *        the writer reads as narrative (no inline filter/spread to decode) and the merge rule lives
 *        in one testable place
 */
export const getValidKeysWithKeyUpserted = ({
  current,
  for: forKeyWithMetadata,
}: {
  current: KeyWithMetadata[];
  for: KeyWithMetadata;
}): KeyWithMetadata[] => {
  // drop any prior entry for this key, so the fresh state fully replaces it
  const withoutPrior = current.filter(
    ({ key }) => key !== forKeyWithMetadata.key,
  );

  // append the fresh entry unless it is expired (an expired record is an invalidation → dropped)
  if (isRecordExpired(forKeyWithMetadata)) return withoutPrior;
  return [...withoutPrior, forKeyWithMetadata];
};
