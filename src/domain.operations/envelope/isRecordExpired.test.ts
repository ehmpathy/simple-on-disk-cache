import { getMseNow } from '../../utils/getMseNow';
import { isRecordExpired } from './isRecordExpired';

/**
 * unit coverage for the pure expiry-check transformer
 *
 * .why = isRecordExpired decides record validity off an absolute expiry; per
 *        test-coverage-by-grain a transformer earns a dedicated unit test — the null→never,
 *        past→expired, future→live branches are the invariants.
 */
describe('isRecordExpired', () => {
  test('a null expiry never expires', () => {
    expect(isRecordExpired({ expiresAtMse: null })).toEqual(false);
  });

  test('a past expiry is expired', () => {
    expect(isRecordExpired({ expiresAtMse: getMseNow() - 1_000 })).toEqual(
      true,
    );
  });

  test('a future expiry is not expired', () => {
    expect(isRecordExpired({ expiresAtMse: getMseNow() + 60_000 })).toEqual(
      false,
    );
  });
});
