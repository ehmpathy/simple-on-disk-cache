# simple-on-disk-cache

![ci_on_commit](https://github.com/ehmpathy/simple-on-disk-cache/workflows/ci_on_commit/badge.svg)
![deploy_on_tag](https://github.com/ehmpathy/simple-on-disk-cache/workflows/deploy_on_tag/badge.svg)

A simple on-disk cache with support for local and cloud filesystem targets and time-based expiration policies.

# install

```sh
npm install --save simple-on-disk-cache
```

# usage

### local filesystem

persist cache to a local filesystem

```ts
import { createCache } from 'simple-on-disk-cache';

const cache = createCache({
  directory: {
    local: {
      path: `${__dirname}/tmp`,
    },
  },
});

await cache.set('purpose-of-life', '42');
const purpose = await cache.get('purpose-of-life'); // '42'
```

### cloud storage

persist cache to any cloud storage via adapter (e.g., aws s3)

```ts
import { createCache } from 'simple-on-disk-cache';
import { sdkAwsS3 } from 'sdk-aws-s3'; // or any adapter that satisfies SimpleOnDiskCacheCloudAdapter

const cache = createCache({
  directory: {
    cloud: {
      path: 's3://__bucket_name__/__prefix__',
      via: sdkAwsS3,
    },
  },
});

await cache.set('purpose-of-life', '42');
const purpose = await cache.get('purpose-of-life'); // '42'
```

### list keys

list all valid (non-expired) keys in the cache

```ts
const keys = await cache.keys(); // ['purpose-of-life', 'other-key', ...]
```

### default expiration

items expire after 5 minutes by default. change this when you create the cache:

```ts
const cache = createCache({
  directory: { local: { path: './cache' } },
  expiration: { minutes: 10 }, // 10 minutes
});
```

use `null` for items that never expire:

```ts
const cache = createCache({
  directory: { local: { path: './cache' } },
  expiration: null, // never expires by default
});
```

### per-item expiration

override expiration when you set an item:

```ts
// expires in 1 hour
await cache.set('weather', 'sunny', { expiration: { hours: 1 } });

// never expires
await cache.set('gravity', '9.81', { expiration: null });
```

### consistency

by default, `.get` reads the source store (local disk / cloud) every time, so it always reflects the latest write — cross-process overwrites included. this is the correct, no-surprise default.

```ts
// default: source-first (correct)
const cache = createCache({
  directory: { local: { path: './cache' } },
});
```

when one writer owns the store (single-writer, write-once, or immutable data), opt into `memory-first` for a per-hot-key perf win (~15ms disk / hundreds of ms cloud → ns). a memory hit short-circuits the source read:

```ts
// opt-in: memory-first (fast), for single-writer / write-once usecases
const cache = createCache({
  directory: { local: { path: './cache' } },
  consistency: 'memory-first',
});
```

on a memory-first cache, force a one-off source read with a per-read override. the read value wins over the cache-wide default, and leaves memory warm with the source value:

```ts
// per-read override: force a source read on a memory-first cache
await cache.get('election-winner', { consistency: 'source-first' });
```

### safe cache keys

cache keys must be safe for filesystems (alphanumeric, `.`, `-`, `_` only). use `castToSafeOnDiskCacheKey` to generate safe keys from procedure inputs:

```ts
import { castToSafeOnDiskCacheKey } from 'simple-on-disk-cache';

const key = castToSafeOnDiskCacheKey({
  procedure: {
    name: 'fetchUserProfile',
    version: '1.0.0', // bump to invalidate prior cached results
  },
  execution: {
    input: { userId: 'abc-123', includeDetails: true },
  },
});
// 'fetchUserProfile._userId_abc_123_includeDetails_true.a1b2c3d4...'

await cache.set(key, JSON.stringify(userProfile));
```

# api

### `createCache(options)`

creates a cache instance.

| option | type | default | description |
|--------|------|---------|-------------|
| `directory` | `DirectoryToPersistTo` | required | where to persist cache files |
| `expiration` | `UniDuration \| null` | `{ minutes: 5 }` | default TTL for items |
| `consistency` | `SimpleOnDiskCacheConsistency` | `'source-first'` | read polarity: `'source-first'` reads the source store every time (correct); `'memory-first'` short-circuits on an in-process memory hit (fast, single-writer only) |

### `cache.get(key, options?)`

returns `Promise<string | undefined>`. returns `undefined` if not found or expired.

| option | type | description |
|--------|------|-------------|
| `consistency` | `SimpleOnDiskCacheConsistency` | override the cache-wide consistency for this read; a per-read value wins over the cache default |

### `cache.set(key, value, options?)`

returns `Promise<void>`. value can be `string`, `undefined`, or `Promise<string | undefined>`.

| option | type | description |
|--------|------|-------------|
| `expiration` | `UniDuration \| null` | override default expiration |

### `cache.keys()`

returns `Promise<string[]>`. lists all valid (non-expired) keys.

# types

```ts
import type {
  SimpleOnDiskCache,
  SimpleOnDiskCacheConsistency,
  DirectoryToPersistTo,
  SimpleOnDiskCacheCloudAdapter,
} from 'simple-on-disk-cache';
```

### `SimpleOnDiskCacheConsistency`

read polarity for the cache:

```ts
type SimpleOnDiskCacheConsistency = 'source-first' | 'memory-first';
```

### `SimpleOnDiskCacheCloudAdapter`

interface for cloud storage adapters:

```ts
type SimpleOnDiskCacheCloudAdapter = {
  get:
    | { one: (input: { uri: string }) => Promise<string | null> }
    | ((input: { uri: string }) => Promise<string | null>);
  set: (input: { uri: string; body: string }) => Promise<void>;
};
```
