import { getMseNow } from '../../utils/getMseNow';
import { getValidKeysWithKeyUpserted } from './getValidKeysWithKeyUpserted';

/**
 * unit coverage for the pure valid-keys upsert transformer
 *
 * .why = getValidKeysWithKeyUpserted owns the "modify" step of the valid-keys read-modify-write;
 *        per test-coverage-by-grain a transformer earns a dedicated unit test — the add,
 *        replace-prior, and drop-expired branches are the invariants.
 */
const future = getMseNow() + 60_000;
const past = getMseNow() - 60_000;

describe('getValidKeysWithKeyUpserted', () => {
  test('appends a fresh key that is not already present', () => {
    const result = getValidKeysWithKeyUpserted({
      current: [{ key: 'a', expiresAtMse: future }],
      for: { key: 'b', expiresAtMse: future },
    });
    expect(result).toEqual([
      { key: 'a', expiresAtMse: future },
      { key: 'b', expiresAtMse: future },
    ]);
  });

  test('replaces the prior entry for a key already present (no duplicate)', () => {
    const result = getValidKeysWithKeyUpserted({
      current: [{ key: 'a', expiresAtMse: 111 }],
      for: { key: 'a', expiresAtMse: future },
    });
    expect(result).toEqual([{ key: 'a', expiresAtMse: future }]);
  });

  test('drops the key when its fresh entry is expired (invalidation)', () => {
    const result = getValidKeysWithKeyUpserted({
      current: [
        { key: 'a', expiresAtMse: future },
        { key: 'b', expiresAtMse: future },
      ],
      for: { key: 'a', expiresAtMse: past },
    });
    expect(result).toEqual([{ key: 'b', expiresAtMse: future }]);
  });
});
