/**
 * cast a cache value to its most observable stored form
 *
 * .what = if the value is json-parseable, return the parsed value (so the on-disk envelope is
 *         easy to read by hand); otherwise return the raw string unchanged. undefined passes
 *         through (a tombstone is as observable as it gets).
 * .why = the on-disk cache file is a human-read artifact; a parsed json value reads far better
 *        than an escaped json-in-json string. the caller flags `deserializedForObservability` off
 *        `typeof result !== 'string'` so a later read can reserialize losslessly.
 */
export const asMostObservableValue = ({
  value,
}: {
  value: string | undefined;
}): unknown => {
  // if its undefined, its as observable as it gets
  if (value === undefined) return undefined;

  // see if can json.parse
  try {
    // if we can, then return the parsed value, so when we save it it is easy to read manually
    return JSON.parse(value);
  } catch (error) {
    // a non-json string is the only handled case (JSON.parse throws SyntaxError); rethrow all else
    if (!(error instanceof SyntaxError)) throw error;

    // otherwise, return the raw value, no more we can do
    return value;
  }
};
