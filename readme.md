# simple-on-disk-cache

![ci_on_commit](https://github.com/ehmpathy/simple-on-disk-cache/workflows/ci_on_commit/badge.svg)
![deploy_on_tag](https://github.com/ehmpathy/simple-on-disk-cache/workflows/deploy_on_tag/badge.svg)

A simple on-disk cache, supporting local and remote filesystem targets, with time based expiration policies.

# Install

```sh
npm install --save simple-on-disk-cache
```

# Example

### locally mounted

You can easily get and set to a cache persisted in a locally mounted filesystem

```ts
import { createCache } from 'simple-on-disk-cache';

const { set, get } = createCache({
  directoryToPersistTo: {
    mounted: {
      path: `${__dirname}/tmp`,
    }
  },
});
set('meaning-of-life', '42');
const meaningOfLife = get('meaning-of-life'); // returns 42
```

### aws s3

You can also easily get and set from a cache persisted in an aws s3 fileystem

```ts
import { createCache } from 'simple-on-disk-cache';

const { set, get } = createCache({
  directoryToPersistTo: {
    s3: {
      bucket: '__bucket_name__',
      prefix: '__prefix__',
    }
  },
});
set('meaning-of-life', '42');
const meaningOfLife = get('meaning-of-life'); // returns 42
```

### default expiration

Items in the cache live 5 minutes until expiration, by default.

You can change this default when creating the cache:

```ts
const { set, get } = createCache({ defaultSecondsUntilExpiration: 10 * 60 }); // updates the default seconds until expiration to 10 minutes
```

### per item expiration

And you can also override this when setting an item:

```ts
set('acceleration due to gravity', '9.81', { secondsUntilExpiration: Infinity }); // gravity will not change, so we dont need to expire it
```
