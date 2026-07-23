import { getMseNow } from '../../utils/getMseNow';
import { getExpiresAtMse } from './getExpiresAtMse';

/**
 * unit coverage for the pure write-time expiry transformer
 *
 * .why = getExpiresAtMse centralizes the write-time expiry rule; per test-coverage-by-grain a
 *        transformer earns a dedicated unit test — the tombstone→0, no-expiry→Infinity, and
 *        with-duration→now+duration branches are the invariants.
 */
describe('getExpiresAtMse', () => {
  test('a tombstone (value undefined) expires at epoch 0 (immediately invalid)', () => {
    expect(getExpiresAtMse({ value: undefined, expiration: null })).toEqual(0);
  });

  test('a real write with no expiration never expires (Infinity)', () => {
    expect(getExpiresAtMse({ value: 'v', expiration: null })).toEqual(Infinity);
  });

  test('a real write with a duration expires at now + the duration', () => {
    const before = getMseNow();
    const result = getExpiresAtMse({ value: 'v', expiration: { seconds: 10 } });
    // the expiry is ~10s ahead of the clock read just before the call
    expect(result).toBeGreaterThanOrEqual(before + 10_000);
    expect(result).toBeLessThan(before + 10_000 + 5_000); // generous upper bound
  });
});
