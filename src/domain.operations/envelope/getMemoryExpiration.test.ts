import { getMseNow } from '../../utils/getMseNow';
import { getMemoryExpiration } from './getMemoryExpiration';

/**
 * unit coverage for the pure memory-expiration transformer
 *
 * .why = getMemoryExpiration pins the memory tier to the disk tier's absolute expiry; per
 *        test-coverage-by-grain a transformer earns a dedicated unit test — the clamp-at-0
 *        (already-expired) branch and the positive-left branch are the invariants.
 */
describe('getMemoryExpiration', () => {
  test('a future disk expiry yields a positive left-until-expiry duration', () => {
    // a disk expiry 10s in the future must yield a left-value near 10s (never above it)
    const expiresAtMse = getMseNow() + 10_000;
    const { milliseconds } = getMemoryExpiration({ expiresAtMse });
    expect(milliseconds).toBeGreaterThan(0);
    expect(milliseconds).toBeLessThanOrEqual(10_000);
  });

  test('a past disk expiry clamps to 0 (already expired, never negative)', () => {
    // a disk expiry 5s in the past must clamp to 0, not a negative duration
    const expiresAtMse = getMseNow() - 5_000;
    expect(getMemoryExpiration({ expiresAtMse })).toEqual({ milliseconds: 0 });
  });

  test('a null disk expiry (no-expiry entry) yields a never-expires memory duration', () => {
    // null = a no-expiry entry (Infinity round-tripped through JSON); memory must never expire either
    expect(getMemoryExpiration({ expiresAtMse: null })).toEqual({
      milliseconds: Infinity,
    });
  });
});
