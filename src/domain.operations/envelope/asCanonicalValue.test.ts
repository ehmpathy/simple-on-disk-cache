import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';
import { asCanonicalValue } from './asCanonicalValue';

/**
 * unit coverage for the pure content-hash input transformer
 *
 * .why = asCanonicalValue defines the stable string the local disk version token hashes; per
 *        test-coverage-by-grain a transformer earns a dedicated unit test that pins its logic —
 *        the empty-sentinel collapse for tombstone/absent is the token-stability invariant.
 */
const CASES: {
  description: string;
  given: CacheEnvelope;
  expect: string;
}[] = [
  {
    description: 'a plain string value is the canonical value verbatim',
    given: { expiresAtMse: null, value: 'hello' },
    expect: 'hello',
  },
  {
    description: 'a tombstone collapses to the empty sentinel',
    given: { expiresAtMse: 0, value: undefined },
    expect: '',
  },
  {
    description:
      'a non-string, non-observability value collapses to the empty sentinel',
    given: { expiresAtMse: null, value: 42 },
    expect: '',
  },
  {
    description:
      'an observability-parsed value reserializes to its canonical json string',
    given: {
      expiresAtMse: null,
      deserializedForObservability: true,
      value: { a: 1 },
    },
    expect: '{"a":1}',
  },
];

describe('asCanonicalValue', () => {
  CASES.map((thisCase) =>
    test(thisCase.description, () => {
      expect(asCanonicalValue(thisCase.given)).toEqual(thisCase.expect);
    }),
  );
});
