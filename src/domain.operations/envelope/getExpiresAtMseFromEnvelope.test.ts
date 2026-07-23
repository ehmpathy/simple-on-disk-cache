import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';
import { getExpiresAtMseFromEnvelope } from './getExpiresAtMseFromEnvelope';

/**
 * unit coverage for the pure expiry-extraction transformer
 *
 * .why = getExpiresAtMseFromEnvelope decides logical presence off a parsed envelope for conditional
 *        ops; per test-coverage-by-grain a transformer earns a dedicated unit test — the null-vs-0
 *        distinction is a correctness invariant (null = never-expires must NOT collapse to 0, or a
 *        no-expiry key would falsely read as absent).
 */
const CASES: {
  description: string;
  given: CacheEnvelope | null;
  expect: number | null;
}[] = [
  {
    description: 'a numeric expiresAtMse is returned as the stored timestamp',
    given: { expiresAtMse: 4567, value: 'v' },
    expect: 4567,
  },
  {
    description:
      'a null expiresAtMse (no-expiry entry) stays null (never expires)',
    given: { expiresAtMse: null, value: 'v' },
    expect: null,
  },
  {
    description:
      'a null envelope (corrupt/absent) reads as 0 (expired-at-epoch)',
    given: null,
    expect: 0,
  },
];

describe('getExpiresAtMseFromEnvelope', () => {
  CASES.map((thisCase) =>
    test(thisCase.description, () => {
      expect(getExpiresAtMseFromEnvelope(thisCase.given)).toEqual(
        thisCase.expect,
      );
    }),
  );
});
