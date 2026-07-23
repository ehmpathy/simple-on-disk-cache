import { SimpleCacheConditionError } from '../../domain.objects/SimpleCacheConditionError';
import { assertConditionMet } from './assertConditionMet';

/**
 * unit coverage for the pure precondition gate
 *
 * .why = assertConditionMet is a pure transformer (the shared compare-and-set gate); per the
 *        test-coverage-by-grain standard, a transformer earns a dedicated unit test — the
 *        integration suite exercises it end-to-end, this pins the logic in isolation.
 */
const CASES: {
  description: string;
  given: { condition: { version: string | null }; found: string | undefined };
  expect: { throws: boolean; message?: string };
}[] = [
  {
    description: 'put-if-absent: no throw when the key is absent',
    given: { condition: { version: null }, found: undefined },
    expect: { throws: false },
  },
  {
    description: 'put-if-absent: throws when the key is present',
    given: { condition: { version: null }, found: 'tokenA' },
    expect: {
      throws: true,
      message: 'cache condition failed: expected key to be absent',
    },
  },
  {
    description: 'compare-and-set: no throw when the version matches',
    given: { condition: { version: 'tokenA' }, found: 'tokenA' },
    expect: { throws: false },
  },
  {
    description: 'compare-and-set: throws when the version differs',
    given: { condition: { version: 'tokenA' }, found: 'tokenB' },
    expect: {
      throws: true,
      message: 'cache condition failed: version mismatch',
    },
  },
  {
    description: 'compare-and-set: throws when the key is absent',
    given: { condition: { version: 'tokenA' }, found: undefined },
    expect: {
      throws: true,
      message: 'cache condition failed: version mismatch',
    },
  },
];

describe('assertConditionMet', () => {
  CASES.map((thisCase) =>
    test(thisCase.description, () => {
      // build the invocation under the case's condition + found
      const invoke = () =>
        assertConditionMet({
          key: 'some-key',
          condition: thisCase.given.condition,
          found: thisCase.given.found,
        });

      // a no-throw case must return without a throw
      if (!thisCase.expect.throws) {
        expect(invoke).not.toThrow();
        return;
      }

      // a throw case must raise the shared condition error, with the canonical message
      // (assertConditionMet throws synchronously, so assert directly via toThrow — no async wrap)
      expect(invoke).toThrow(SimpleCacheConditionError);
      expect(invoke).toThrow(thisCase.expect.message);
    }),
  );
});
