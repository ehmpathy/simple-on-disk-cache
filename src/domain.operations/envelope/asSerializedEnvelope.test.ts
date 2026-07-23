import { asParsedEnvelope } from './asParsedEnvelope';
import { asSerializedEnvelope } from './asSerializedEnvelope';
import { asValueFromEnvelope } from './asValueFromEnvelope';

/**
 * unit coverage for the pure on-disk envelope writer
 *
 * .why = asSerializedEnvelope is the one owner of the persisted envelope shape; per
 *        test-coverage-by-grain a transformer earns a dedicated unit test — the
 *        observability-flag branch and the round-trip invariant are what matter.
 */
describe('asSerializedEnvelope', () => {
  test('a plain (non-json) string is stored un-parsed (deserializedForObservability=false)', () => {
    const envelope = asParsedEnvelope(
      asSerializedEnvelope({ value: 'hello', expiresAtMse: 123 }),
    );
    expect(envelope).toEqual({
      expiresAtMse: 123,
      deserializedForObservability: false,
      value: 'hello',
    });
  });

  test('a json-string value is stored parsed for observability (deserializedForObservability=true)', () => {
    const envelope = asParsedEnvelope(
      asSerializedEnvelope({ value: '{"a":1}', expiresAtMse: 123 }),
    );
    expect(envelope).toEqual({
      expiresAtMse: 123,
      deserializedForObservability: true,
      value: { a: 1 },
    });
  });

  test('round-trips a json-string value: serialize → parse → derive yields the original string', () => {
    // the token-stability invariant: what get() returns must equal what was written
    const original = '{"a":1}';
    const envelope = asParsedEnvelope(
      asSerializedEnvelope({ value: original, expiresAtMse: 123 }),
    );
    expect(envelope).not.toEqual(null);
    expect(asValueFromEnvelope(envelope!)).toEqual(original);
  });
});
