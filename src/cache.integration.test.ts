import { sleep } from '@ehmpathy/uni-time';
import { promises as fs } from 'fs';

import { createCache, RESERVED_CACHE_KEY_FOR_VALID_KEYS } from './cache';

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
    it('should consider secondsUntilExpiration of null or infinity as never expiring', async () => {
      const { set, get } = createCache({
        directoryToPersistTo,
        defaultSecondsUntilExpiration: 0, // expire immediately
      });

      // prove that setting something to the cache with default state will have it expired immediately
      await set('dory-memory', 'something'); // lets see if dory can remember something
      const doryMemory = await get('dory-memory');
      expect(doryMemory).toEqual(undefined); // its already gone! dang default expiration

      // prove that if we record the memory with expires-at Infinity, it persists
      await set('elephant-memory', 'something', {
        secondsUntilExpiration: Infinity,
      });
      const elephantMemory = await get('elephant-memory');
      expect(elephantMemory).toEqual('something');
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
    it('should support invalidation by setting a keys value to undefined', async () => {
      const { set, get } = createCache({ directoryToPersistTo });
      await set('is-cereal-soup', 'yes');
      const answer = await get('is-cereal-soup');
      expect(answer).toEqual('yes');
      await set('is-cereal-soup', undefined);
      const answerNow = await get('is-cereal-soup');
      expect(answerNow).toEqual(undefined);
    });
    it('should keep accurate track of keys', async () => {
      // clear out the old keys, so that other tests dont affect the keycounting we want to do here
      await fs.unlink(
        `${directoryToPersistTo.mounted.path}/${RESERVED_CACHE_KEY_FOR_VALID_KEYS}`,
      );

      // create the cache
      const { set, keys } = createCache({
        directoryToPersistTo,
      });

      // check key is added when value is set
      await set('meaning-of-life', '42');
      const keys1 = await keys();
      expect(keys1.length).toEqual(1);
      expect(keys1[0]).toEqual('meaning-of-life');

      // check that there are no duplicates when key value is updated
      await set('meaning-of-life', '42.0');
      const keys2 = await keys();
      expect(keys2.length).toEqual(1);
      expect(keys2[0]).toEqual('meaning-of-life');

      // check that multiple keys can be set
      await set('purpose-of-life', 'propagation');
      const keys3 = await keys();
      expect(keys3.length).toEqual(2);
      expect(keys3[1]).toEqual('purpose-of-life');

      // check that invalidation removes the key
      await set('meaning-of-life', undefined);
      const keys4 = await keys();
      expect(keys4.length).toEqual(1);
      expect(keys4[0]).toEqual('purpose-of-life');
    });
  });
  describe('s3', () => {
    const directoryToPersistTo = {
      s3: {
        bucket: 'ehmpathy-simple-on-disk-cache-test-bucket',
        prefix: 'test/integration/s3',
      },
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

      // prove that the value is still accessible after 8 seconds, since default ttl is 10 seconds
      await sleep(8 * 1000);
      const popcornStatusAfter9Sec = await get('how-popped-is-the-popcorn');
      expect(popcornStatusAfter9Sec).toEqual('not popped'); // still should say not popped

      // and prove that after a total of 10 seconds, the status is no longer in the cache
      await sleep(2 * 1000); // sleep 2 more second
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
      await sleep(3 * 1000);
      const iceCreamStateAfter4Sec = await get('ice-cream-state');
      expect(iceCreamStateAfter4Sec).toEqual('solid'); // still should say solid

      // and prove that after a total of 5 seconds, the state is no longer in the cache
      await sleep(2 * 1000); // sleep 2 more second
      const iceCreamStateAfter5Sec = await get('ice-cream-state');
      expect(iceCreamStateAfter5Sec).toEqual(undefined); // no longer defined, since the item level seconds until expiration was 5
    });
    it('should return undefined if a key has never been cached', async () => {
      const { get } = createCache({ directoryToPersistTo });
      const value = await get('ghostie');
      expect(value).toEqual(undefined);
    });
    it('should support an async getter for the directory to persist to', async () => {
      const { set, get } = createCache({ directoryToPersistTo });
      await set('what-do-you-call-a-fake-noodle', 'an-impasta');
      const answer = await get('what-do-you-call-a-fake-noodle');
      expect(answer).toEqual('an-impasta');
    });
  });
});
