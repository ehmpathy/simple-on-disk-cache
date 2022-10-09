import { sleep } from '../../../utils/sleep';
import { createCache } from './cache';

describe('cache', () => {
  describe('mounted', () => {
    const directoryToPersistTo = { mounted: { path: `${__dirname}/__tmp__` } };
    it('should be able to add an item to the cache', async () => {
      const { set } = createCache({ directoryToPersistTo });
      await set('meaning-of-life', '42');
    });
    it('should be able to get an item from the cache', async () => {
      const { set, get } = createCache({ directoryToPersistTo });
      await set(
        'how-many-licks-does-it-take-to-get-to-the-center-of-a-tootsie-pop',
        '3',
      );
      const licks = await get(
        'how-many-licks-does-it-take-to-get-to-the-center-of-a-tootsie-pop',
      );
      expect(licks).toEqual('3');
    });
    it('should respect the default expiration for the cache', async () => {
      const { set, get } = createCache({
        directoryToPersistTo,
        defaultSecondsUntilExpiration: 10,
      }); // we're gonna use this cache to keep track of the popcorn in the microwave - we should check more regularly since it changes quickly!
      await set('how-popped-is-the-popcorn', 'not popped');

      // prove that we recorded the value and its accessible immediately after setting
      const popcornStatus = await get('how-popped-is-the-popcorn');
      expect(popcornStatus).toEqual('not popped');

      // prove that the value is still accessible after 9 seconds, since default ttl is 10 seconds
      await sleep(9 * 1000);
      const popcornStatusAfter9Sec = await get('how-popped-is-the-popcorn');
      expect(popcornStatusAfter9Sec).toEqual('not popped'); // still should say not popped

      // and prove that after a total of 9 seconds, the status is no longer in the cache
      await sleep(1 * 1000); // sleep 1 more second
      const popcornStatusAfter10Sec = await get('how-popped-is-the-popcorn');
      expect(popcornStatusAfter10Sec).toEqual(undefined); // no longer defined, since the default seconds until expiration was 15
    });
    it('should respect the item level expiration for the cache', async () => {
      const { set, get } = createCache({ directoryToPersistTo }); // remember, default expiration is greater than 1 min
      await set('ice-cream-state', 'solid', { secondsUntilExpiration: 5 }); // ice cream changes quickly in the heat! lets keep a quick eye on this

      // prove that we recorded the value and its accessible immediately after setting
      const iceCreamState = await get('ice-cream-state');
      expect(iceCreamState).toEqual('solid');

      // prove that the value is still accessible after 4 seconds, since default ttl is 5 seconds
      await sleep(4 * 1000);
      const iceCreamStateAfter4Sec = await get('ice-cream-state');
      expect(iceCreamStateAfter4Sec).toEqual('solid'); // still should say solid

      // and prove that after a total of 5 seconds, the state is no longer in the cache
      await sleep(1 * 1000); // sleep 1 more second
      const iceCreamStateAfter5Sec = await get('ice-cream-state');
      expect(iceCreamStateAfter5Sec).toEqual(undefined); // no longer defined, since the item level seconds until expiration was 5
    });
    it('should return undefined if a key has never been cached', async () => {
      const { get } = createCache({ directoryToPersistTo });
      const value = await get('ghostie');
      expect(value).toEqual(undefined);
    });
  });
  describe.skip('s3', () => {
    const directoryToPersistTo = {
      s3: { bucket: '__todo__', prefix: '__test__' },
    };
    it('should be able to add an item to the cache', async () => {
      const { set } = createCache({ directoryToPersistTo });
      await set('meaning-of-life', '42');
    });
    it('should be able to get an item from the cache', async () => {
      const { set, get } = createCache({ directoryToPersistTo });
      await set(
        'how-many-licks-does-it-take-to-get-to-the-center-of-a-tootsie-pop',
        '3',
      );
      const licks = await get(
        'how-many-licks-does-it-take-to-get-to-the-center-of-a-tootsie-pop',
      );
      expect(licks).toEqual(3);
    });
    it('should respect the default expiration for the cache', async () => {
      const { set, get } = createCache({
        directoryToPersistTo,
        defaultSecondsUntilExpiration: 10,
      }); // we're gonna use this cache to keep track of the popcorn in the microwave - we should check more regularly since it changes quickly!
      await set('how-popped-is-the-popcorn', 'not popped');

      // prove that we recorded the value and its accessible immediately after setting
      const popcornStatus = await get('how-popped-is-the-popcorn');
      expect(popcornStatus).toEqual('not popped');

      // prove that the value is still accessible after 9 seconds, since default ttl is 10 seconds
      await sleep(9 * 1000);
      const popcornStatusAfter9Sec = await get('how-popped-is-the-popcorn');
      expect(popcornStatusAfter9Sec).toEqual('not popped'); // still should say not popped

      // and prove that after a total of 9 seconds, the status is no longer in the cache
      await sleep(1 * 1000); // sleep 1 more second
      const popcornStatusAfter10Sec = await get('how-popped-is-the-popcorn');
      expect(popcornStatusAfter10Sec).toEqual(undefined); // no longer defined, since the default seconds until expiration was 15
    });
    it('should respect the item level expiration for the cache', async () => {
      const { set, get } = createCache({ directoryToPersistTo }); // remember, default expiration is greater than 1 min
      await set('ice-cream-state', 'solid', { secondsUntilExpiration: 5 }); // ice cream changes quickly in the heat! lets keep a quick eye on this

      // prove that we recorded the value and its accessible immediately after setting
      const iceCreamState = await get('ice-cream-state');
      expect(iceCreamState).toEqual('solid');

      // prove that the value is still accessible after 4 seconds, since default ttl is 5 seconds
      await sleep(4 * 1000);
      const iceCreamStateAfter4Sec = await get('ice-cream-state');
      expect(iceCreamStateAfter4Sec).toEqual('solid'); // still should say solid

      // and prove that after a total of 5 seconds, the state is no longer in the cache
      await sleep(1 * 1000); // sleep 1 more second
      const iceCreamStateAfter5Sec = await get('ice-cream-state');
      expect(iceCreamStateAfter5Sec).toEqual(undefined); // no longer defined, since the item level seconds until expiration was 5
    });
    it('should return undefined if a key has never been cached', async () => {
      const { get } = createCache({ directoryToPersistTo });
      const value = await get('ghostie');
      expect(value).toEqual(undefined);
    });
  });
});
