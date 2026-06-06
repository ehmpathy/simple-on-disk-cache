# handoff: with-bottleneck

## .what

new ehmpathy package `with-bottleneck` — rate limiting and concurrency control utilities.

## .why

`bottleneck` (npm) is abandonware:
- last publish: 2019-08-03 (7 years)
- last maintainer commit: 2020-07-21 (5+ years)
- security PRs ignored since 2021
- not archived but effectively dead

alternatives reviewed:
- `p-queue` — esm-only, sindresorhus "feature complete" (no new dev)
- `limiter` — rate limiting only, no schedule pattern
- `async-sema` — concurrency only, no rate limiting

none fit ehmpathy patterns (input/context, dependency injection).

---

## .core concept: two usecases

`withBottleneck` supports two distinct patterns for providing the bottleneck:

| usecase | binding time | bottleneck source | when to use |
|---------|--------------|-------------------|-------------|
| **per declaration** | declaration time | static instance | global limits, scripts, simple cases |
| **per context** | call time | extracted from context | per-tenant, DI, testability |

---

## .usecase 1: per declaration

bottleneck is created once and bound at declaration time. all calls share the same bottleneck instance.

```ts
import { withBottleneck, genBottleneck } from 'with-bottleneck';

// create bottleneck at module level
const bottleneck = genBottleneck({
  concurrency: 5,
  velocity: { quantity: 10, duration: { seconds: 1 } }
});

// bind to function at declaration
const fetchLimited = withBottleneck(fetch, { bottleneck });

// all calls share the same bottleneck
await fetchLimited('https://api.example.com/a');
await fetchLimited('https://api.example.com/b');
await fetchLimited('https://api.example.com/c');
```

### when to use per declaration

- single global rate limit for an API
- module-level limiter
- simple scripts
- bottleneck config known at build time

---

## .usecase 2: per context

bottleneck is resolved from context at call time. each call can use a different bottleneck.

```ts
import { withBottleneck, genBottleneck, Bottleneck } from 'with-bottleneck';

// declare function — bottleneck comes from context
const fetchLimited = withBottleneck(fetch, {
  bottleneck: (_input, context) => context.usecase.bottleneck,
});

// create different bottlenecks for different tenants
const customerBottleneck = genBottleneck({
  concurrency: 2,
  velocity: { quantity: 5, duration: { seconds: 1 } }
});
const adminBottleneck = genBottleneck({
  concurrency: 10,
  velocity: { quantity: 100, duration: { seconds: 1 } }
});

// each call uses bottleneck from its context
await fetchLimited('https://api.example.com/data', {
  usecase: { bottleneck: customerBottleneck }
});

await fetchLimited('https://api.example.com/data', {
  usecase: { bottleneck: adminBottleneck }
});
```

### when to use per context

- different rate limits per tenant/customer
- per-request configuration
- testability (inject mock/spy bottleneck)
- bottleneck config determined at runtime

### full DI example

```ts
import { withBottleneck, genBottleneck, Bottleneck } from 'with-bottleneck';

// 1. define context type
interface UsecaseContext {
  bottleneck: Bottleneck;
}

// 2. define operation with bottleneck from context
const syncCustomerData = withBottleneck(
  async (
    input: { customerId: string },
    context: { usecase: UsecaseContext }
  ) => {
    const data = await fetch(`/api/customers/${input.customerId}`);
    return data.json();
  },
  {
    bottleneck: (_input, context) => context.usecase.bottleneck,
  },
);

// 3. wire up in composition root
const createContext = (tenant: 'free' | 'premium'): { usecase: UsecaseContext } => ({
  usecase: {
    bottleneck: tenant === 'premium'
      ? genBottleneck({ concurrency: 10, velocity: { quantity: 100, duration: { seconds: 1 } } })
      : genBottleneck({ concurrency: 2, velocity: { quantity: 10, duration: { seconds: 1 } } }),
  },
});

// 4. call with tenant-specific context
await syncCustomerData({ customerId: '123' }, createContext('free'));
await syncCustomerData({ customerId: '456' }, createContext('premium'));
```

---

## .exports

| export | purpose |
|--------|---------|
| `Bottleneck` | type — the bottleneck instance shape |
| `genBottleneck(config)` | create `Bottleneck` instance |
| `withBottleneck(fn, { bottleneck })` | wrap fn with bottleneck |

---

## .genBottleneck config

```ts
import { IsoDuration } from 'iso-time';

interface BottleneckConfig {
  /**
   * max concurrent operations (how many at once)
   * @default Infinity
   */
  concurrency?: number;

  /**
   * rate limit (how many per time)
   * @default undefined (no rate limit)
   */
  velocity?: {
    /** how many operations */
    quantity: number;
    /** per duration (from iso-time) */
    duration: IsoDuration;
  };
}
```

### examples

```ts
// concurrency only: max 5 at once
genBottleneck({ concurrency: 5 });

// velocity only: max 10 per second (object format)
genBottleneck({ velocity: { quantity: 10, duration: { seconds: 1 } } });

// velocity only: max 100 per minute (string format)
genBottleneck({ velocity: { quantity: 100, duration: 'PT1M' } });

// both: max 5 at once, max 100 per minute
genBottleneck({
  concurrency: 5,
  velocity: { quantity: 100, duration: { minutes: 1 } }
});
```

---

## .Bottleneck shape

```ts
interface Bottleneck {
  /**
   * the inner semaphore — for manual acquire/release
   */
  semaphore: {
    /** acquire a slot, blocks until available */
    acquire: () => Promise<void>;

    /** release a slot */
    release: () => void;

    /** count of queued waiters */
    queued: number;

    /** count of active slots */
    active: number;
  };

  /**
   * schedule fn for execution — acquires, runs, releases automatically
   *
   * equivalent to:
   *   await semaphore.acquire();
   *   try { return await fn(); }
   *   finally { semaphore.release(); }
   */
  schedule: <T>(fn: () => Promise<T>) => Promise<T>;
}
```

### why expose semaphore?

`schedule` is sugar over acquire/try/finally/release. direct semaphore access allows:

```ts
// manual control for complex flows
await bottleneck.semaphore.acquire();
try {
  // do multiple things within one slot
  const a = await fetchA();
  const b = await fetchB(a);
  return transform(b);
} finally {
  bottleneck.semaphore.release();
}

// check state without schedule
if (bottleneck.semaphore.queued > 100) {
  throw new Error('queue too deep, backpressure');
}
```

---

## .withBottleneck signature

```ts
type BottleneckProvider<TInput, TContext> =
  | Bottleneck                                    // static instance
  | ((input: TInput, context: TContext) => Bottleneck);  // from context

function withBottleneck<TFn extends (input: any, context: any) => Promise<any>>(
  fn: TFn,
  options: {
    bottleneck: BottleneckProvider<Parameters<TFn>[0], Parameters<TFn>[1]>;
  },
): TFn;
```

---

## .implementation notes

- token bucket algorithm for `velocity`
- no redis/clustering in v1 — pure in-memory
- errors propagate to caller (no internal retry — compose with `with-retry`)
- could build on `simple-in-memory-queue` infrastructure

---

## .why "bottleneck"

a bottleneck is not a defect — it's precision design.

the neck of a beer bottle is *intentional*:
- controls pour rate
- prevents spills
- enables clean pour

a bottle without a neck would be a bucket.

same here: we *want* a bottleneck to control flow:
- limit API calls to avoid bans
- limit DB connections to avoid saturation
- limit concurrent requests to respect server capacity

**bottleneck = intentional, precise flow control**

the npm `bottleneck` package name was well chosen. we continue where it left off.

---

## .prior art

| feature | bottleneck (dead) | p-queue | with-bottleneck |
|---------|-------------------|---------|-----------------|
| concurrency | `maxConcurrent` | `concurrency` | `concurrency` |
| rate limit | `minTime`, `reservoir` | `interval`, `intervalCap` | `velocity` |
| schedule | `.schedule()` | `.add()` | `.schedule()` |
| HOF wrapper | — | — | `withBottleneck()` |
| DI support | no | no | per context pattern |
| esm/cjs | both | esm only | both |

---

## .repo

create: `ehmpathy/with-bottleneck`

## .dependencies

zero deps preferred for portability. maybe `type-fns` if needed.
