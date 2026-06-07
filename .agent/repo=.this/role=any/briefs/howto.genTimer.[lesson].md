# howto.genTimer

## .what

genTimer tracks time from an absolute start point, regardless of operation duration.

## .why

relative sleeps drift when operations take variable time:

```ts
// 👎 bad — drift accumulates
await set('key', 'value');        // takes 2500ms (S3 latency)
await sleep(3000);                // sleeps 3000ms more
// total: 5500ms from start, not 3000ms
```

genTimer computes time left from the original target:

```ts
// 👍 good — absolute time from start
const timer3s = genTimer({ for: { seconds: 3 } });
await set('key', 'value');        // takes 2500ms
await sleep(timer3s.get().left);  // sleeps 500ms (3000 - 2500)
// total: 3000ms from start
```

## .pattern

```ts
import { toMilliseconds, UniDuration } from '@ehmpathy/uni-time';

const genTimer = (input: { for: UniDuration }) => {
  const startedAtMse = Date.now();
  const targetMse = startedAtMse + toMilliseconds(input.for);
  return {
    get: () => ({
      left: { milliseconds: Math.max(0, targetMse - Date.now()) },
    }),
  };
};
```

## .usage

```ts
// create timer before the operation you want to measure from
const timer5s = genTimer({ for: { seconds: 5 } });
const timer10s = genTimer({ for: { seconds: 10 } });

await expensiveOperation();  // variable latency

// check at 5s from timer creation, not from operation end
await sleep(timer5s.get().left);
const valueAt5s = await get('key');

// check at 10s from timer creation
await sleep(timer10s.get().left);
const valueAt10s = await get('key');
```

## .when

- test cache expiration with variable write latency
- verify timeouts against absolute deadlines
- any test where operation duration varies but check time must be consistent
