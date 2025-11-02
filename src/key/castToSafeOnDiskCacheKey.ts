import { asHashSha256Sync } from 'hash-fns';
import { asSerialJSON, Serializable } from 'serde-fns';

/**
 * .what = casts details about the execution of a procedure into a safe on disk cache key
 * .why =
 *   - eliminates special characters, which are incompatible with on-disk file names
 *   - ensures to namespace to a procedure name, to avoid cross procedures cache-key collisions
 *   - reminds to use a procedure.version, to enable invalidation of prior versions of procedures
 */
export const castToSafeOnDiskCacheKey = <TInput extends Serializable>(input: {
  /**
   * .what = info about the procedure you'd like to cache for
   */
  procedure: {
    /**
     * .what = the name of the procedure to cache for
     * .why =
     *   - ensures that each procedure gets its own namespace in the cache
     */
    name: string;

    /**
     * .what = the version of the procedure to cache for
     * .why =
     *   - ensures that if you upgrade the logic within your procedure, you can invalidate all of the prior cached results
     */
    version: string | null;
  };

  /**
   * .what = info about the execution of the procedure that you'd like to cache for
   */
  execution: {
    /**
     * the input that the procedure was executed with
     */
    input: TInput;
  };
}): string =>
  [
    // fn name
    input.procedure.name,

    // input preview (dynamodbkeys limit = 2k, s3keys limit = 1k, ondisk limit = 255)
    asSerialJSON(input.execution.input)
      .replace(/[{}[\]:,]/gi, '_')
      .replace(/[^0-9a-z_]/gi, '')
      .replace(/__+/g, '_')
      .slice(0, 100) // todo: make the length dependent on the rest of the cache key. fill the 255char limit (consider name, account id, and hash)
      .replace(/^_/, '')
      .replace(/_$/, ''), // stringify + replace all non-alphanumeric input,

    // then, suffix with a unique id of the input + prompt
    asHashSha256Sync(
      asSerialJSON([
        input.execution.input,
        input.procedure.version
          ? asHashSha256Sync(input.procedure.version)
          : null,
      ]),
    ),
  ].join('.');
