import { SimpleCacheConditionError } from '../../domain.objects/SimpleCacheConditionError';

/**
 * a cross-package-safe type guard for a cache condition failure
 *
 * .what = true when an unknown thrown value is a SimpleCacheConditionError — from THIS package or
 *         from any other package that declares the structurally-identical class (e.g.
 *         with-simple-cache, which redefines it to avoid a dependency cycle)
 * .why = the class is redefined in more than one package (with-simple-cache depends on this
 *        package at runtime, so a shared class would form a cycle), so a bare `instanceof` fails
 *        across the package boundary — two distinct constructors for the same logical error. a
 *        generic conditional-cache consumer (e.g. a with-simple-mutex over WithCacheConditionals<T>)
 *        needs a reliable runtime check that does not depend on which concrete backend threw. both
 *        copies are `class SimpleCacheConditionError extends ConstraintError {}`, so the constructor
 *        name is a stable cross-package marker; a local `instanceof` covers this package's own throws.
 */
export const isSimpleCacheConditionError = (
  error: unknown,
): error is SimpleCacheConditionError => {
  if (error instanceof SimpleCacheConditionError) return true; // this package's own
  if (typeof error !== 'object' || error === null) return false;
  return error.constructor?.name === 'SimpleCacheConditionError'; // any package's copy
};
