import { asErrorClassName } from './asErrorClassName';

/**
 * the cloud-disk adapter error class names that signal a conditional-write precondition failure
 *
 * .why = sdk-aws-s3 surfaces two: S3PreconditionFailedError (http 412, compare-and-set miss) and
 *        S3ConditionalConflictError (put-if-absent conflict). the cache must translate both into
 *        one SimpleCacheConditionError so consumers see a single error contract across tiers.
 * .note = these names are pinned to sdk-aws-s3@0.2.0's error taxonomy (the version this repo
 *         installs). detection is by class name (not `instanceof`) to keep sdk-aws-s3 a
 *         devDependency-only — but that means a rename/restructure of these classes in a future
 *         sdk-aws-s3 bump would silently stop the cloud-conflict translation. the real-s3 leg of
 *         runConditionalSuite is the guard: it drives an actual 412/conflict through this list, so
 *         a taxonomy change surfaces as a test failure on the dep bump, not silently in prod.
 */
const CLOUD_PRECONDITION_ERROR_NAMES = [
  'S3PreconditionFailedError',
  'S3ConditionalConflictError',
];

/**
 * detect a precondition-failed signal from a conditional cloud-disk adapter (e.g. sdk-aws-s3's
 * S3PreconditionFailedError / S3ConditionalConflictError, http 412 / conflict)
 *
 * .why = the cache stays decoupled from any specific cloud sdk; it recognizes the decided
 *        precondition failure by class name, then rethrows it as SimpleCacheConditionError so
 *        consumers see one error contract across the local and cloud disks
 */
export const isPreconditionFailure = (error: unknown): boolean =>
  CLOUD_PRECONDITION_ERROR_NAMES.includes(asErrorClassName(error) ?? '');
