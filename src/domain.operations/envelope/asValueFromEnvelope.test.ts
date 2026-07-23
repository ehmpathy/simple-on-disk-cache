import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';
import { asValueFromEnvelope } from './asValueFromEnvelope';

/**
 * unit coverage for the pure value-derivation transformer
 *
 * .why = asValueFromEnvelope is the ONE owner of the "reserialize observability values, else pass
 *        the string through" rule that both get() and the content-hash token depend on; per
 *        test-coverage-by-grain a transformer earns a dedicated unit test that pins its logic.
 */
const CASES: {
  description: string;
  given: CacheEnvelope;
  expect: string | undefined;
}[] = [
  {
    description: 'a tombstone (value undefined) yields undefined',
    given: { expiresAtMse: 0, value: undefined },
    expect: undefined,
  },
  {
    description: 'a plain string value passes through unchanged',
    given: { expiresAtMse: null, value: 'hello' },
    expect: 'hello',
  },
  {
    description:
      'an observability-parsed value is reserialized via JSON.stringify',
    given: {
      expiresAtMse: null,
      deserializedForObservability: true,
      value: { a: 1 },
    },
    expect: '{"a":1}',
  },
  {
    description:
      'a non-string value without the observability flag yields undefined',
    given: { expiresAtMse: null, value: 42 },
    expect: undefined,
  },
];

describe('asValueFromEnvelope', () => {
  CASES.map((thisCase) =>
    test(thisCase.description, () => {
      expect(asValueFromEnvelope(thisCase.given)).toEqual(thisCase.expect);
    }),
  );
});
