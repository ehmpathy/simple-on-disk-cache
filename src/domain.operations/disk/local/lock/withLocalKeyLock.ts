import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { UnexpectedCodePathError } from 'helpful-errors';

import { getMseNow } from '../../../../utils/getMseNow';
import { asErrorCode } from '../../../error/asErrorCode';
import { delTolerantOfAbsent } from '../delTolerantOfAbsent';
import { genLockExclusive } from './genLockExclusive';

/**
 * time bounds for the local-disk per-key exclusive lock (named, to avoid magic values)
 */
const LOCAL_LOCK_STALE_MSE = 30_000; // reclaim a lock held past this — its writer likely crashed
const LOCAL_LOCK_SPIN_MSE = 25; // backoff between acquire attempts under contention
const LOCAL_LOCK_DEADLINE_MSE = 5_000; // give up (fail loud) past this, rather than hang forever

/**
 * run a critical section under an exclusive per-key lock file (cross-process, via O_EXCL link)
 *
 * .what = serializes the read-check-write of a local-disk conditional write, so a concurrent writer
 *         cannot slip a change between our version check and our write (a TOCTOU race)
 * .why = this lock is the LOCAL DISK's substitute for a native atomic compare-and-set, which the
 *        machine filesystem does not offer; an O_EXCL lock gives cross-process mutual exclusion for
 *        the brief check-write window. the CLOUD DISK needs no equivalent — its supplier (s3) makes
 *        conditional writes atomic at the server via If-Match / If-None-Match, so only the local
 *        disk path takes this lock. a lock left by a crashed holder is reclaimed after
 *        LOCAL_LOCK_STALE_MSE; acquisition fails loud past LOCAL_LOCK_DEADLINE_MSE, not hang.
 */
export const withLocalKeyLock = async <T>(
  input: { lockPath: string },
  fn: () => Promise<T>,
): Promise<T> => {
  const { lockPath } = input;
  const deadlineMse = getMseNow() + LOCAL_LOCK_DEADLINE_MSE;

  // this acquisition's unique lock identity: the acquire timestamp (a stealer parses it to detect a
  // stale, likely-crashed holder) joined to a unique per-acquisition token (the releaser compares it
  // to prove ownership). one atomic lock-file write carries both — `${acquiredAtMse}.${uuid}`.
  const ownLockValue = `${getMseNow()}.${randomUUID()}`;

  // read the lock file's current value, or null when it has vanished (ENOENT = not held); fail loud
  // on any other fs fault
  const readHeldValue = async (): Promise<string | null> =>
    fs.readFile(lockPath, { encoding: 'utf-8' }).catch((error) => {
      if (asErrorCode(error) === 'ENOENT') return null; // the lock vanished → not held
      throw error;
    });

  // parse the acquire-timestamp half of a lock value (the digits before the first '.'); 0 when the
  // value is absent or unparseable, so a malformed lock reads as "not stale" and is left alone
  const asHeldAtMse = (value: string): number =>
    Number(value.split('.')[0]) || 0;

  // steal the current holder's lock ONLY if it is stale (its writer likely crashed mid-section). a
  // two-read compare closes the steal TOCTOU: delete only if the value is STILL the exact stale one
  // we observed — if another stealer already reclaimed and re-minted it (a fresh timestamp + token),
  // its value differs, so we leave it and let the caller back off and retry.
  const tryStealStaleLock = async (): Promise<void> => {
    const heldValue = await readHeldValue();
    const heldAtMse = heldValue === null ? 0 : asHeldAtMse(heldValue);
    if (!heldAtMse || getMseNow() - heldAtMse <= LOCAL_LOCK_STALE_MSE) return; // fresh → leave it
    const stillHeldValue = await readHeldValue();
    if (stillHeldValue === heldValue) await delTolerantOfAbsent(lockPath);
  };

  // acquire — win an exclusive create, steal a stale lock, or fail loud at the deadline.
  // .note = an iterative loop (not recursion) so the frame count stays flat regardless of how long
  //         contention lasts — no chance of stack growth over the deadline window.
  const acquire = async (): Promise<void> => {
    for (;;) {
      if (await genLockExclusive({ path: lockPath, value: ownLockValue }))
        return; // acquired

      // a holder exists — steal it only when stale (its writer likely crashed mid-section)
      await tryStealStaleLock();

      // fail loud rather than hang forever
      if (getMseNow() > deadlineMse)
        // multi-line message (one sentence per line, like InvalidOnDiskCacheKeyError) so the error
        // reads cleanly. the four sentences are single-`\n`-joined; helpful-errors appends the
        // metadata dump after a `\n\n`, so a snapshot of `.split('\n\n')[0]` pins the full, static
        // remediation guidance (all four sentences) yet drops the random lockPath metadata.
        throw new UnexpectedCodePathError(
          [
            // humanize the bounds to seconds for the caller who reads this under a failure
            // (raw ms stays in the metadata below for machines, e.g. deadlineMse)
            `could not acquire the local cache key lock within ${LOCAL_LOCK_DEADLINE_MSE / 1000}s — another writer holds it and did not release within the deadline.`,
            `this is expected only under heavy same-key write contention or a stuck writer.`,
            `to fix: retry the operation (transient contention clears on its own), or if a process crashed mid-write, delete the stale lock file at the lockPath below (it is auto-reclaimed after ${LOCAL_LOCK_STALE_MSE / 1000}s).`,
            `the local tier is per-machine — for cross-machine coordination use the cloud (s3) tier.`,
          ].join('\n'),
          {
            lockPath,
            deadlineMse: LOCAL_LOCK_DEADLINE_MSE,
            staleMse: LOCAL_LOCK_STALE_MSE,
          },
        );

      // back off, then retry
      await new Promise((done) => setTimeout(done, LOCAL_LOCK_SPIN_MSE));
    }
  };
  await acquire();

  // run the critical section, then release OUR lock — a compare-and-delete on the lock file: delete
  // it ONLY if it still holds our token. .why = if our section ran past LOCAL_LOCK_STALE_MSE, a
  // stealer may have already reclaimed the lock and be mid-section under its OWN token; an
  // unconditional delete here would remove that live holder's lock and break the mutual exclusion
  // this lock exists to provide (a third writer could then slip in). so we read first and delete only
  // our own — the same "is this still the lock I saw?" discipline the steal path uses, applied
  // reflexively to our release. delTolerantOfAbsent ignores ENOENT (already gone) and only throws on
  // a genuine fs fault (permission/disk) — a real error that belongs in the open, not swallowed. a
  // finally guarantees the release attempt; in the rare case BOTH fn() and the cleanup throw, node
  // surfaces the cleanup fault (loud, never silent). we deliberately do NOT `.catch(() => undefined)`
  // the cleanup: a silent swallow is itself a failhide (rule.forbid.failhide).
  try {
    return await fn();
  } finally {
    if ((await readHeldValue()) === ownLockValue)
      await delTolerantOfAbsent(lockPath);
  }
};
