import { SimpleCacheConditionError } from '../../domain.objects/SimpleCacheConditionError';
import { throwConditionMismatch } from './throwConditionMismatch';

/**
 * unit coverage for the compare-and-set conflict message builder
 *
 * .why = throwConditionMismatch is a pure transformer that owns the canonical "version mismatch"
 *        message across two call sites; per test-coverage-by-grain it earns a dedicated unit test
 *        that pins the exact error class + message + metadata in isolation.
 */
describe('throwConditionMismatch', () => {
  test('throws SimpleCacheConditionError with the canonical message', () => {
    const invoke = (): never =>
      throwConditionMismatch({
        key: 'some-key',
        condition: { version: 'tokenA' },
        found: 'tokenB',
      });
    expect(invoke).toThrow(SimpleCacheConditionError);
    expect(invoke).toThrow('cache condition failed: version mismatch');
  });

  test('carries { key, condition, found } on the error metadata', () => {
    try {
      throwConditionMismatch({
        key: 'some-key',
        condition: { version: 'tokenA' },
        found: 'tokenB',
      });
      throw new Error(
        'expected throwConditionMismatch to throw, but it did not',
      );
    } catch (error) {
      if (!(error instanceof SimpleCacheConditionError)) throw error;
      expect(error.metadata.key).toEqual('some-key');
      expect(error.metadata.condition).toEqual({ version: 'tokenA' });
      expect(error.metadata.found).toEqual('tokenB');
    }
  });
});
