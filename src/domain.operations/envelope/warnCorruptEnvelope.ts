/**
 * emit a warn-log that a cache file could not be parsed
 *
 * .what = writes a console.warn that flags the corrupt (unparseable) cache file for the given key
 * .why = isolates the raw console i/o out of the get orchestrator so it reads as narrative; a
 *        corrupt file counts as logically absent, but we surface it since it should not occur.
 */
export const warnCorruptEnvelope = ({ key }: { key: string }): void => {
  // eslint-disable-next-line no-console
  console.warn(
    'simple-on-disk-cache: detected unparseable cache file. treating the result as invalid. this should not have occurred',
    { key },
  );
};
