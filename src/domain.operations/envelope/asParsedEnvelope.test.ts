import { asParsedEnvelope } from './asParsedEnvelope';

/**
 * unit coverage for the pure envelope reader
 *
 * .why = asParsedEnvelope is the one canonical envelope parser (get + conditional reads route
 *        through it); per test-coverage-by-grain a transformer earns a dedicated unit test that
 *        pins the corrupt-tolerance rule (corrupt → null, valid → object).
 */
describe('asParsedEnvelope', () => {
  test('parses a valid envelope json string into its object form', () => {
    const raw = JSON.stringify({ expiresAtMse: 123, value: 'v' });
    expect(asParsedEnvelope(raw)).toEqual({ expiresAtMse: 123, value: 'v' });
  });

  test('reads a corrupt (non-json) envelope as null (logically absent)', () => {
    expect(asParsedEnvelope('not-json-at-all')).toEqual(null);
  });
});
