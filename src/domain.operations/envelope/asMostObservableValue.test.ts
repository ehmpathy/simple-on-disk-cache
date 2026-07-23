import { asMostObservableValue } from './asMostObservableValue';

/**
 * unit coverage for the pure observability-cast transformer
 *
 * .why = asMostObservableValue decides the human-readable on-disk form (parsed json when
 *        possible, else the raw string); per test-coverage-by-grain a transformer earns a
 *        dedicated unit test that pins the parse-vs-passthrough branches.
 */
const CASES: {
  description: string;
  given: string | undefined;
  expect: unknown;
}[] = [
  {
    description: 'undefined passes through (a tombstone is already observable)',
    given: undefined,
    expect: undefined,
  },
  {
    description: 'a json object string is parsed to its object form',
    given: '{"a":1}',
    expect: { a: 1 },
  },
  {
    description: 'a json number string is parsed to its number form',
    given: '42',
    expect: 42,
  },
  {
    description: 'a non-json string is returned raw unchanged',
    given: 'hello',
    expect: 'hello',
  },
];

describe('asMostObservableValue', () => {
  CASES.map((thisCase) =>
    test(thisCase.description, () => {
      expect(asMostObservableValue({ value: thisCase.given })).toEqual(
        thisCase.expect,
      );
    }),
  );
});
