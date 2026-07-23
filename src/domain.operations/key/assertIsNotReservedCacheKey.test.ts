import { getError } from 'test-fns';

import { RESERVED_CACHE_KEY_FOR_VALID_KEYS } from '../../domain.objects/RESERVED_CACHE_KEY_FOR_VALID_KEYS';
import { ReservedOnDiskCacheKeyError } from '../../domain.objects/ReservedOnDiskCacheKeyError';
import { assertIsNotReservedCacheKey } from './assertIsNotReservedCacheKey';

describe('assertIsNotReservedCacheKey', () => {
  describe('given the reserved valid-keys sentinel key', () => {
    it('should throw ReservedOnDiskCacheKeyError so a caller cannot corrupt the index', () => {
      const error = getError(() =>
        assertIsNotReservedCacheKey({
          key: RESERVED_CACHE_KEY_FOR_VALID_KEYS,
        }),
      );
      expect(error).toBeInstanceOf(ReservedOnDiskCacheKeyError);
    });
  });

  describe('given an ordinary caller key', () => {
    it('should not throw', () => {
      expect(() =>
        assertIsNotReservedCacheKey({ key: 'an-ordinary-key' }),
      ).not.toThrow();
    });
  });
});
