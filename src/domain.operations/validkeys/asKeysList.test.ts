import { asKeysList } from './asKeysList';

describe('asKeysList', () => {
  it('projects metadata down to bare key names', () => {
    const keys = [
      { key: 'a', expiresAtMse: 10 },
      { key: 'b', expiresAtMse: 20 },
    ];
    expect(asKeysList(keys)).toEqual(['a', 'b']);
  });

  it('returns an empty list for no keys', () => {
    expect(asKeysList([])).toEqual([]);
  });
});
