import type { CacheEnvelope } from '../../domain.objects/CacheEnvelope';
import { asLocalVersionToken } from './asLocalVersionToken';

/**
 * unit coverage for the local disk version token transformer
 *
 * .why = the token is the etag of the content — it MUST be deterministic (same canonical value →
 *        same token, so a write-time and a later read-time token agree) and content-sensitive
 *        (different canonical value → different token, so a compare-and-set can detect a change).
 */
describe('asLocalVersionToken', () => {
  describe('given two envelopes with byte-identical canonical value', () => {
    it('should mint the same token so a later read agrees with the write', async () => {
      const a: CacheEnvelope = { expiresAtMse: 1, value: 'hello' };
      const b: CacheEnvelope = { expiresAtMse: 999, value: 'hello' }; // differ only by expiry
      expect(await asLocalVersionToken(a)).toEqual(
        await asLocalVersionToken(b),
      );
    });
  });

  describe('given two envelopes with different canonical value', () => {
    it('should mint different tokens so a compare-and-set can detect the change', async () => {
      const a: CacheEnvelope = { expiresAtMse: null, value: 'hello' };
      const b: CacheEnvelope = { expiresAtMse: null, value: 'world' };
      expect(await asLocalVersionToken(a)).not.toEqual(
        await asLocalVersionToken(b),
      );
    });
  });
});
