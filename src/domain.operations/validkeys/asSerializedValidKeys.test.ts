import { asSerializedValidKeys } from './asSerializedValidKeys';

describe('asSerializedValidKeys', () => {
  it('serializes a metadata list to its json string form', () => {
    const keys = [
      { key: 'a', expiresAtMse: 10 },
      { key: 'b', expiresAtMse: 20 },
    ];
    expect(asSerializedValidKeys(keys)).toEqual(JSON.stringify(keys));
  });

  it('round-trips through asParsedValidKeys', () => {
    const keys = [{ key: 'a', expiresAtMse: 10 }];
    expect(JSON.parse(asSerializedValidKeys(keys))).toEqual(keys);
  });

  it('serializes an empty list', () => {
    expect(asSerializedValidKeys([])).toEqual('[]');
  });
});
