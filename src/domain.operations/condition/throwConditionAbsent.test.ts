import { SimpleCacheConditionError } from '../../domain.objects/SimpleCacheConditionError';
import { throwConditionAbsent } from './throwConditionAbsent';

/**
 * unit coverage for the put-if-absent conflict message builder
 *
 * .why = throwConditionAbsent is a pure transformer that owns the canonical "expected key to be
 *        absent" message across two call sites; per test-coverage-by-grain it earns a dedicated
 *        unit test that pins the exact error class + message + metadata in isolation.
 */
describe('throwConditionAbsent', () => {
  test('throws SimpleCacheConditionError with the canonical message', () => {
    const invoke = (): never =>
      throwConditionAbsent({
        key: 'some-key',
        condition: { version: null },
        found: 'tokenA',
      });
    expect(invoke).toThrow(SimpleCacheConditionError);
    expect(invoke).toThrow('cache condition failed: expected key to be absent');
  });

  test('carries { key, condition, found } on the error metadata', () => {
    try {
      throwConditionAbsent({
        key: 'some-key',
        condition: { version: null },
        found: 'tokenA',
      });
      throw new Error('expected throwConditionAbsent to throw, but it did not');
    } catch (error) {
      if (!(error instanceof SimpleCacheConditionError)) throw error;
      expect(error.metadata.key).toEqual('some-key');
      expect(error.metadata.condition).toEqual({ version: null });
      expect(error.metadata.found).toEqual('tokenA');
    }
  });
});
