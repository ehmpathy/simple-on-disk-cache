import { promises as fs } from 'fs';
import { sleep } from './utils/sleep';
import { createCache } from './cache';

jest.setTimeout(60 * 1000);

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
    it('should save to disk the value json parsed, if parseable, to make it easier to observe when debugging', async () => {
      const { get, set } = createCache({ directoryToPersistTo });

      // set
      const key = 'city';
      const value = JSON.stringify({
        name: 'atlantis',
        galaxy: 'pegasus',
        code: 821,
      });
      await set(key, value);

      // check that in the file it was json parsed before stringified
      const contents = await fs.readFile(
        [directoryToPersistTo.mounted.path, key].join('/'),
        {
          encoding: 'utf-8',
        },
      );
      const parsedContents = JSON.parse(contents);
      expect(parsedContents.deserializedForObservability).toEqual(true);
      expect(typeof parsedContents.value).not.toEqual('string');

      // check that we can read the value
      const foundValue = await get(key);
      expect(foundValue).toEqual(value);
    });
    it('should expose the error on set, if a promise that resolves with an error was called to be set to the cache', async () => {
      const { set } = createCache({ directoryToPersistTo });

      // define the value
      const key = 'surprise';
      const expectedError = new Error('surprise!');
      const value = Promise.reject(expectedError);

      // prove the error is thrown onSet
      try {
        await set(key, value);
        throw new Error('should not reach here');
      } catch (error) {
        expect(error).toEqual(expectedError);
      }

      // prove nothing was set into the cache for this key
      const fileExists = await await fs
        .readFile([directoryToPersistTo.mounted.path, key].join('/'), {
          encoding: 'utf-8',
        })
        .then(() => true)
        .catch((error) => {
          if (error.code === 'ENOENT') return false;
          throw error; // otherwise, something else is messed up
        });
      expect(fileExists).toEqual(false);
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
