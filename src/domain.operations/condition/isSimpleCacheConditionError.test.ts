import { given, then, when } from 'test-fns';

import { SimpleCacheConditionError as RealSimpleCacheConditionError } from '../../domain.objects/SimpleCacheConditionError';
import { isSimpleCacheConditionError } from './isSimpleCacheConditionError';

// a stand-in for another package's structurally-identical copy of the class — with-simple-cache
// redefines `class SimpleCacheConditionError extends ConstraintError {}` to avoid a dependency
// cycle, so a real consumer sees two distinct constructors that share the same class name
class SimpleCacheConditionError extends Error {}

describe('isSimpleCacheConditionError', () => {
  given('this package own error instance', () => {
    when('checked', () => {
      then('it is recognized (local instanceof)', () => {
        const error = new RealSimpleCacheConditionError(
          'cache condition failed: version mismatch',
          { key: 'k', condition: { version: null }, found: undefined },
        );
        expect(isSimpleCacheConditionError(error)).toEqual(true);
      });
    });
  });

  given('another package same-named copy', () => {
    when('checked', () => {
      then('it is recognized by constructor name (cross-package-safe)', () => {
        const foreign = new SimpleCacheConditionError('conflict');
        expect(isSimpleCacheConditionError(foreign)).toEqual(true);
      });
    });
  });

  given('an unrelated error or non-error value', () => {
    when('checked', () => {
      then('a plain Error is not recognized', () => {
        expect(isSimpleCacheConditionError(new Error('nope'))).toEqual(false);
      });
      then('null / undefined / primitives are not recognized', () => {
        expect(isSimpleCacheConditionError(null)).toEqual(false);
        expect(isSimpleCacheConditionError(undefined)).toEqual(false);
        expect(
          isSimpleCacheConditionError('SimpleCacheConditionError'),
        ).toEqual(false);
      });
    });
  });
});
