import { asParsedValidKeys } from './asParsedValidKeys';

describe('asParsedValidKeys', () => {
  it('parses a serialized list into typed metadata', () => {
    const raw = JSON.stringify([
      { key: 'a', expiresAtMse: 10 },
      { key: 'b', expiresAtMse: 20 },
    ]);
    expect(asParsedValidKeys(raw)).toEqual([
      { key: 'a', expiresAtMse: 10 },
      { key: 'b', expiresAtMse: 20 },
    ]);
  });

  it('returns an empty list when the record is absent', () => {
    expect(asParsedValidKeys(undefined)).toEqual([]);
  });

  it('returns an empty list for a serialized empty list', () => {
    expect(asParsedValidKeys('[]')).toEqual([]);
  });
});
