# simple-on-disk-cache

![ci_on_commit](https://github.com/ehmpathy/simple-on-disk-cache/workflows/ci_on_commit/badge.svg)
![deploy_on_tag](https://github.com/ehmpathy/simple-on-disk-cache/workflows/deploy_on_tag/badge.svg)

A simple in-memory cache, for nodejs and the browser, with time based expiration policies.

# Install

```sh
npm install --save simple-on-disk-cache
```

# Example

Quickly set and get from the cache:

```ts
import { createCache } from 'simple-on-disk-cache';

const { set, get } = createCache();
set('meaning of life', 42);
const meaningOfLife = get('meaning of life'); // returns 42
```

Items in the cache live 5 minutes until expiration, by default.

You can change this default when creating the cache:

```ts
const { set, get } = createCache({ defaultSecondsUntilExpiration: 10 * 60 }); // updates the default seconds until expiration to 10 minutes
```

And you can also override this when setting an item:

```ts
set('acceleration due to gravity', 9.81, { secondsUntilExpiration: Infinity }); // gravity will not change, so we dont need to expire it
```
