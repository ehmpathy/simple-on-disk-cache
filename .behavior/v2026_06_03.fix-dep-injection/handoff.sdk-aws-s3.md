# handoff: sdk-aws-s3 package

## context

general-purpose S3 SDK wrapper. follows ehmpathy SDK patterns.

unrelated to `simple-on-disk-cache` — that package just happens to be one consumer.

## package spec

### identity

- **name**: `sdk-aws-s3`
- **purpose**: ergonomic wrapper for `@aws-sdk/client-s3`
- **peer dep**: `@aws-sdk/client-s3` (user installs, we don't bundle)

### export shape

```ts
import { sdkAwsS3 } from 'sdk-aws-s3';

// via URI (recommended)
const content = await sdkAwsS3.get.one({ uri: 's3://my-bucket/path/to/object' });
await sdkAwsS3.set({ uri: 's3://my-bucket/path/to/object', body: 'content' });
await sdkAwsS3.del({ uri: 's3://my-bucket/path/to/object' });

// via bucket + key (also supported)
const content = await sdkAwsS3.get.one({ bucket: 'my-bucket', key: 'path/to/object' });
await sdkAwsS3.set({ bucket: 'my-bucket', key: 'path/to/object', body: 'content' });

// list objects
const objects = await sdkAwsS3.get.all({ bucket: 'my-bucket', prefix: 'path/to/' });
const objects = await sdkAwsS3.get.all({ uri: 's3://my-bucket/path/to/' });
```

### operations

| operation | input | output |
|-----------|-------|--------|
| `get.one` | `{ uri }` or `{ bucket, key }` | `string \| null` |
| `get.all` | `{ uri }` or `{ bucket, prefix }` | `Array<{ key, content }>` |
| `set` | `{ uri, body }` or `{ bucket, key, body }` | `void` |
| `del` | `{ uri }` or `{ bucket, key }` | `void` |

### URI format

```
s3://bucket/path/to/key
```

parsed as:
- scheme: `s3`
- bucket: first path segment
- key: rest of path

### 404 semantics

`get.one` returns `null` for not-found, never throws.

**dual 404 check required** — SDK behavior varies:

```ts
if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
  return null;
}
```

### context injection

all operations accept optional context for client reuse:

```ts
const client = new S3Client({ region: 'us-east-1' });

await sdkAwsS3.get.one(
  { uri: 's3://my-bucket/foo' },
  { s3: client }
);
```

### tests

integration tests against real S3 (localstack or test bucket):

1. `get.one` returns `null` for non-existent key
2. `set` then `get.one` returns the value
3. `set` overwrites extant value
4. `del` removes object
5. `get.all` lists objects with prefix
6. URI parse works for all operations
7. non-404 errors propagate with context

---

## usage with simple-on-disk-cache

symmetric with local paths:

```ts
import { sdkAwsS3 } from 'sdk-aws-s3';
import { createCache } from 'simple-on-disk-cache';

const cache = createCache({
  directory: {
    cloud: { path: 's3://my-bucket/cache/', via: sdkAwsS3 }
  },
});
```

the cache calls `sdkAwsS3.get.one({ uri: 's3://my-bucket/cache/' + key })` internally.

compare to local:

```ts
const cache = createCache({
  directory: {
    local: { path: './cache/' }
  },
});
```

same shape: `{ path }` for local, `{ path, via }` for cloud.
