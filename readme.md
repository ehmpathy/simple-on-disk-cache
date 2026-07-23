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
| `condition` | `SimpleCacheCondition` | gate the read on a version precondition; throws `SimpleCacheConditionError` on a mismatch. a conditional read is always source-first |

### `cache.set(key, value, options?)`

returns `Promise<void>`. value can be `string`, `undefined`, or `Promise<string | undefined>`.

| option | type | description |
|--------|------|-------------|
| `expiration` | `UniDuration \| null` | override default expiration |
| `condition` | `SimpleCacheCondition` | gate the write on a version precondition (ordered after `expiration`); `{ version: null }` = put-if-absent, `{ version: token }` = compare-and-set; throws `SimpleCacheConditionError` on a precondition miss |

### `cache.version(key)`

returns `Promise<string | undefined>`. the current opaque version token for a key, or
`undefined` when the key is logically absent (never cached or expired). treat the token as an
equality-only value — never parse or order it.

### `cache.keys()`

returns `Promise<string[]>`. lists all valid (non-expired) keys.

## conditional writes

every value carries an opaque version token (an etag). a `condition` lets a write or read
proceed only when the stored version still matches what you expect — the same optimistic-
concurrency model as http `If-Match` / `If-None-Match`:

- **put-if-absent** — `condition: { version: null }` writes only if the key is logically absent.
  the first racer wins; the rest catch `SimpleCacheConditionError`.
- **compare-and-set** — `condition: { version: token }` writes only if the stored version still
  matches the one you read; a slow writer can no longer clobber a fresher value.
- **compare-and-delete** — `set(key, undefined, { condition })` — the release half of a lock.

```ts
import { SimpleCacheConditionError } from 'simple-on-disk-cache';

// compute-once (stampede protection): only the first misser's WRITE lands; the rest converge
if ((await cache.version(key)) === undefined) {
  try {
    await cache.set(key, await computeExpensive(), { condition: { version: null } });
  } catch (error) {
    if (!(error instanceof SimpleCacheConditionError)) throw error; // someone beat us — re-read below
  }
}
return cache.get(key);
```

> note: put-if-absent deduplicates the **write**, not the **compute**. under true parallel
> contention, if two callers both observe `version(key) === undefined` before either has written,
> both still run `computeExpensive()` — only one of their writes lands; the loser catches
> `SimpleCacheConditionError` and re-reads the winner's value. so "compute-once" is exact when the
> callers are serialized by the cache (one misses, computes, writes; later missers see the value),
> and "compute-few, store-once" under a genuine herd of simultaneous missers. to bound wasted compute
> under heavy contention, layer a single-flight/mutex in front (which this very primitive can build —
> see the lock example above).

```ts
// optimistic concurrency: write only if no one moved the version since we read it
const token = await cache.version(key);
const next = mutate(await cache.get(key));
await cache.set(key, next, { condition: { version: token } }); // throws if the token went stale
```

> note: the version token is a content etag — it is derived from the stored bytes, not from a random
> per-write id. treat it as opaque + equality-only. the two tiers derive it differently, and that
> difference matters for one edge property:
> - **local disk:** the token is a content hash of the VALUE only (`expiresAtMse` is excluded from
>   the hash input), so two writes of byte-identical content yield the same token regardless of when
>   or with what expiry they were written.
> - **cloud (s3):** the token is s3's server-minted etag over the ENTIRE serialized envelope, which
>   embeds `expiresAtMse`. so two writes of byte-identical content yield the same token only when the
>   serialized bytes agree — i.e. with `expiration: null` (which serializes to a fixed sentinel), or
>   when both writes happen to stamp the same `expiresAtMse`. under a non-null expiration (the
>   default is 5 minutes) each write stamps a fresh wall-clock `expiresAtMse`, so the cloud tier's
>   token WILL differ between two otherwise-identical writes.
>
> this asymmetry never affects correctness — a compare-and-set only ever compares a token you read
> against the token stored now, and no write lands between your read and a store on either tier. it
> only affects the "identical content ⇒ identical token" convenience property, which holds
> unconditionally on local disk but only under `expiration: null` on the cloud disk. a lock/mutex
> holder writes a distinct holder id, so its token differs regardless of tier or expiry.

> note: on the local-disk tier, atomicity is per-machine (an app-level file lock); the s3 tier is
> the global tier. a conditional `get` proves the token was current at check time, not that the
> value stays frozen for a later read.

> note: a compare-and-set against a token that has since LOGICALLY EXPIRED behaves slightly
> differently per tier. on the local disk the version read honors expiry — an expired entry reads as
> absent, so a compare-and-set with its once-valid token throws `SimpleCacheConditionError` (the
> target you meant to update is logically gone). on the cloud disk s3's native compare-and-set gates
> on the PHYSICAL etag, which is unchanged for a still-present-but-expired object, so the same
> compare-and-set SUCCEEDS (it is a valid optimistic-concurrency update — the physical version never
> moved). both are safe; if you need "expired ⇒ reject the update" semantics on the cloud tier, read
> `version(key)` first (it honors expiry on both tiers and returns `undefined` for an expired key).

> note: `get` + `condition` and `set` + `condition` do NOT give the same atomicity. a conditional
> `set` runs its whole read-check-write under the per-key lock (disk) or the native conditional
> write (s3), so it is serialized against concurrent writers. a conditional `get` checks the token
> and returns the value from ONE physical source read (so the token and the value it returns are
> internally consistent — no check-then-read gap), but it takes no lock, so it proves only that the
> token was current at that read, not that the value stays frozen for any later read. do not assume a
> conditional `get` holds a value still the way a conditional `set` guards a write.

> note: compare-and-delete (`set(key, undefined, { condition })`) writes an expired tombstone
> envelope — it does not physically remove the object. this mirrors the library's prior
> delete-by-tombstone convention on every tier, so it applies to BOTH tiers:
> - **s3:** a repeatedly acquired/released lock (or any repeated invalidation) leaves tombstone
>   objects in the bucket that accumulate; pair it with an s3 lifecycle expiry rule on the cache
>   prefix if unbounded growth matters.
> - **local disk:** the same repeated release/reacquire leaves small expired files on disk (never
>   physically unlinked). low severity — `keys()` never scans the directory, so it does not affect
>   read perf — but a high-frequency lock loop accumulates dead files with no automatic cleanup.
>
> tradeoff (why no real delete): the vision's groundwork noted `sdk-aws-s3` exposes a conditional
> `del`, so a real delete was an option. it was deliberately NOT adopted: the
> `SimpleOnDiskCacheCloudAdapter` contract carries no `del` method, so EVERY delete — plain or
> conditional, local or cloud — is a single tombstone overwrite via `set`. that keeps the adapter
> surface minimal (one write primitive, not two) and the delete path uniform across tiers, at the
> cost of the tombstone accumulation above. a real `del` (with s3-lifecycle-free cleanup) is a
> viable follow-up if tombstone growth ever bites a consumer.

> note: `SimpleCacheConditionError` is redefined per package (with-simple-cache depends on this
> package at runtime, so a shared class would form a dependency cycle). a bare cross-package
> `instanceof` therefore returns `false` — two distinct constructors for the same logical error.
> for single-implementation use, `import { SimpleCacheConditionError } from 'simple-on-disk-cache'`
> and `instanceof` it directly (works). for GENERIC code written against `WithCacheConditionals<T>`
> across backends, use the exported guard instead:
>
> ```ts
> import { isSimpleCacheConditionError } from 'simple-on-disk-cache';
> try {
>   await cache.set(lockKey, holderId, { condition: { version: null } });
> } catch (error) {
>   if (isSimpleCacheConditionError(error)) return { acquired: false }; // cross-package-safe
>   throw error;
> }
> ```
>
> a custom cloud adapter must likewise throw `SimpleCacheConditionError` on a precondition failure
> so the cache surfaces one error contract across every tier (the shipped sdk-aws-s3 is translated
> automatically).

> presence layer: `version()` and every conditional op read the physical source entry directly,
> past the valid-keys index that plain `get`/`keys` consult. within the valid-keys write race (a
> key on disk but not yet registered), `version(key)` may report a token while plain `get(key)`
> reads it as absent — conditionals deliberately arbitrate on true physical + expiry state.

> ⚠️ behavior change for ALL local writes (not just conditional ones): because the local tier has
> no native compare-and-set, **every** local `set` — plain or conditional — now serializes under a
> per-key file lock. this is what makes a plain `set` racing a `compare-and-set` on the same key
> safe (without it, a plain write could land between a CAS's version read and its write, a silent
> lost update). the cost + new failure surface applies to every local writer, even one that never
> uses `condition`:
>
> - **cost per write:** a temp-write + link + unlink, not a single write. negligible for typical
>   use, but measurable under very high single-key write rates.
> - **new failure modes:** a `set` now waits on the lock — it reclaims a lock left by a crashed
>   holder after ~30s, and fails loud (`UnexpectedCodePathError`) if it cannot acquire within ~5s
>   rather than hang forever.
> - **orphaned lock file:** if a holder crashes and never returns, its `${key}#lock` file sits on
>   disk until the next writer reclaims it (harmless — `keys()` never scans the directory — but it
>   is not proactively swept).
> - **false reclaim on a slow-but-alive writer:** the 30s stale-reclaim assumes a lock older than
>   30s means a crash. on a slow or degraded filesystem (e.g. the NFS / mounted-dir case, which the
>   per-machine scope already flags as unsupported for cross-machine atomicity), a genuinely
>   slow-but-alive holder could be falsely reclaimed, so two writers briefly proceed — a real
>   double-write, not merely crash tolerance. keep single-machine local dirs for the local tier; use
>   the cloud (s3) tier for any cross-machine coordination.
> - **deadline vs. queue depth:** the 5s acquire deadline is far shorter than the 30s stale
>   threshold, so it is tuned for a low-contention profile: a handful of brief holders per key. under
>   deep same-key contention (many brief writers queued back-to-back), a waiter can hit the 5s ceiling
>   from queue wait alone — none of them stuck, just many ahead of it — and the resulting
>   `UnexpectedCodePathError` ("another writer holds it and did not release within the deadline")
>   reads the same whether the holder is stuck or the queue is merely deep. if your workload writes
>   one hot key from many concurrent producers on one machine, either serialize those writers upstream
>   or move that key's coordination to the cloud (s3) tier, whose native conditional write has no
>   local queue. the two thresholds are compile-time constants today (not per-cache options).
>
> the public `get`/`set` types are unchanged (`condition` is optional), so this is not a
> type-level breaking change — but it is a runtime behavior/perf change for extant consumers,
> called out here explicitly.
>
> **upgrade impact & semver signal.** this is the one part of the release that touches code paths
> a consumer *already runs*: the unconditional local `set` gains lock overhead and a new throwable
> failure mode (`UnexpectedCodePathError` on acquire-deadline / stale-reclaim), even for a consumer
> who never adopts `condition`. the rest of this release is purely additive (`version()`, the
> optional `condition` option), so it is drop-in — but the local-write change is not. treat this
> release as **a behavior break for the local write path** and signal it accordingly: publish it
> under a **major-version** bump (a `feat!` commit with a breaking-change footer) so the change
> surfaces in the changelog and version number, rather than left for a consumer to discover at
> runtime via a stack trace. a consumer that writes local keys under high single-key contention
> should read this section before the upgrade.

# types

```ts
import type {
  SimpleOnDiskCache,
  SimpleOnDiskCacheConsistency,
  SimpleCacheCondition,
  DirectoryToPersistTo,
  SimpleOnDiskCacheCloudAdapter,
} from 'simple-on-disk-cache';
import { SimpleCacheConditionError } from 'simple-on-disk-cache';
```

### `SimpleOnDiskCacheConsistency`

read polarity for the cache:

```ts
type SimpleOnDiskCacheConsistency = 'source-first' | 'memory-first';
```

### `SimpleCacheCondition`

a version precondition for a conditional `get`/`set`:

```ts
type SimpleCacheCondition = { version: string | null };
// version: null  → put-if-absent (write only if logically absent)
// version: token → compare-and-set (write only if the stored version matches)
```

### `SimpleCacheConditionError`

thrown when a `condition` precondition is not met (a `ConstraintError` subclass). carries
`{ key, condition, found }`, where `found` is the current version token (or `undefined` when
logically absent).

### `ReservedOnDiskCacheKeyError`

thrown when a caller passes the key the cache reserves for its own internal valid-keys index —
`_.simple_on_disk_cache.valid_keys` — to `get`, `set`, or `version` (a `ConstraintError` subclass,
carries `{ key }`). the reserved key is character-wise valid, so it passes key validation, but a
public read/write of it would corrupt the index — choose a different key.

### `InvalidOnDiskCacheKeyError`

thrown when a caller passes a key with characters the on-disk cache cannot safely persist (a
`ConstraintError` subclass, carries `{ key }`). only alphanumeric characters plus period, dash, and
underscore are allowed; use `castToSafeOnDiskCacheKey` to derive a safe key from arbitrary input.

### `SimpleOnDiskCacheCloudAdapter`

interface for cloud storage adapters. `include: { meta: true }` surfaces the object's opaque
version token (etag); `condition: { etag }` performs an atomic conditional write (put-if-absent
when `etag` is `null`, compare-and-set when it is a token). on a precondition miss the adapter
throws, and the cache maps that throw to `SimpleCacheConditionError`:

```ts
type SimpleOnDiskCacheCloudAdapter = {
  get:
    | {
        one: (input: {
          uri: string;
          include?: { meta: true };
        }) => Promise<string | null | { body: string; meta: { etag: string } }>;
      }
    | ((input: {
        uri: string;
        include?: { meta: true };
      }) => Promise<string | null | { body: string; meta: { etag: string } }>);
  set: (input: {
    uri: string;
    body: string;
    condition?: { etag: string | null };
    include?: { meta: true };
  }) => Promise<void | { meta: { etag: string } }>;
};
```

> note: conditional writes (`condition`) require an adapter whose `set` honors the `condition`
> param atomically (e.g. `sdkAwsS3`). an adapter that ignores it silently downgrades a
> conditional `set` to last-writer-wins — use one that implements the full contract.

> note: `include: { meta: true }` is requested ONLY by the token paths — `version(key)`, a
> conditional `get`/`set`, and compare-and-delete. a PLAIN `get`/`set`/`keys()` never asks for meta
> (it reads via the plain `get`), so a legacy adapter that returns a bare `string | null` and
> ignores `include.meta` still works for all non-conditional operations — you only need the
> `meta`-capable adapter once you reach for `version`/`condition`.
