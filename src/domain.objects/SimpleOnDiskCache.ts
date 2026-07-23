import type { IsoDuration } from 'iso-time';

import type { SimpleCacheCondition } from './SimpleCacheCondition';
import type { SimpleOnDiskCacheConsistency } from './SimpleOnDiskCacheConsistency';

/**
 * the on-disk cache contract (a disk is either a local disk or a cloud disk)
 *
 * .note = shape-conformance. this interface must structurally satisfy
 *         `WithCacheConditionals<SimpleCacheAsync<string>>` from the published `with-simple-cache`
 *         package (verified by a compile-time assertion in the tests). that canonical, external
 *         contract fixes the method shapes below — so three local conventions are deliberately
 *         deferred to it, each for a cited reason, NOT overlooked:
 *
 *         1. positional args (`get(key, options?)`, `set(key, value, options?)`, `version(key)`)
 *            over the (input, context) shape. the external contract declares these exact positional
 *            signatures; a single-input-object refactor would break structural conformance (an
 *            acceptance criterion). `rule.require.input-context-pattern` yields to the external sdk
 *            contract this package is required to implement.
 *         2. the verb `set` for the mutation. `set` is the canonical method name in the external
 *            contract (and in `rule.require.get-set-gen-verbs`, `set` is a sanctioned mutation verb,
 *            upsert-semantic); a rename to findsert/upsert would break conformance. the conditional
 *            writes are idempotent (put-if-absent / compare-and-set), true to set's upsert intent.
 *         3. the optional `options` argument (and its optional `consistency` / `expiration` /
 *            `condition` members). this is the `options` arg of the (input, options) shape, which
 *            `rule.forbid.undefined-inputs` exempts by scope ("does not apply to … options
 *            arguments"); the external contract's `SimpleCacheGetOptions` / `SimpleCacheSetOptions`
 *            also declare these optional. it is the public user-oriented sdk surface, where optional
 *            options are the paved ux.
 */
export interface SimpleOnDiskCache {
  /**
   * get a value from cache by key
   *
   * options.consistency overrides the cache-wide default for this read
   * - e.g., force a source-first read on an otherwise memory-first cache
   * - note: a source-first read on a memory-first cache also warms the in-memory copy with the fresh source value, so subsequent memory-first reads reflect it
   *
   * options.condition gates the read on a version precondition (a compare-and-read guard)
   * - condition.version === null  → read only if the key is logically absent
   * - condition.version === token → read only if the stored version matches
   * - on a precondition miss, throws SimpleCacheConditionError
   * - note: when condition is supplied, the read is ALWAYS source-first — options.consistency is
   *   ignored, because a conditional read must verify the version against the source of truth (a
   *   memory copy could be stale). so on a memory-first cache, `get(key, { condition })` still reads
   *   the source (and warms memory with the fresh value, as an explicit source-first read does).
   */
  get: (
    key: string,
    options?: {
      consistency?: SimpleOnDiskCacheConsistency;
      condition?: SimpleCacheCondition;
    },
  ) => Promise<string | undefined>;

  /**
   * set a value to cache for key
   *
   * options.condition gates the write on a version precondition (ordered after expiration)
   * - condition.version === null  → put-if-absent (write only if the key is logically absent)
   * - condition.version === token → compare-and-set (write only if the stored version matches)
   * - on a precondition miss, throws SimpleCacheConditionError
   */
  set: (
    key: string,
    value: string | undefined | Promise<string | undefined>,
    options?: {
      expiration?: IsoDuration | null;
      condition?: SimpleCacheCondition;
    },
  ) => Promise<void>;

  /**
   * read the current opaque version token for a key (undefined if logically absent)
   *
   * note
   * - treat the token as an equality-only value; never parse or order it
   * - distinct from `castToSafeOnDiskCacheKey`'s `procedure.version` (a caller-supplied logic
   *   version for key invalidation); this is a per-value content-hash token — same word, different scope
   * - safe to pair with a version condition on get: version(key) then get(key, { condition: { version } })
   * - presence layer: `version` and every conditional op (`get`/`set` with a `condition`) read the
   *   physical source entry directly — past the valid-keys index that plain `get`/`keys` consult.
   *   so within the prior valid-keys write race (a key physically on disk but not yet registered),
   *   `version(key)` can report a token while plain `get(key)`/`keys()` still read it as absent.
   *   this is deliberate: conditionals arbitrate on true physical+expiry state, which is what makes
   *   put-if-absent / compare-and-set safe under concurrency.
   */
  version: (key: string) => Promise<string | undefined>;

  /**
   * list all valid keys in cache
   */
  keys: () => Promise<string[]>;
}
