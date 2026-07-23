import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { withLocalKeyLock } from './withLocalKeyLock';

// integration (touches the real fs): proves the per-key lock's release discipline. the critical
// regression is the ownership-checked release — a holder whose lock was stolen (its section outlived
// the stale bound) must NOT delete the new holder's live lock, else the mutual exclusion this lock
// exists to provide is broken.
describe('withLocalKeyLock', () => {
  const genFreshLockPath = async (): Promise<string> => {
    const dir = `${tmpdir()}/simple-on-disk-cache-lock-test/${randomUUID()}`;
    await fs.mkdir(dir, { recursive: true });
    return `${dir}/key#lock`;
  };

  it('releases only its own lock — a holder whose lock was stolen must not delete the new holder lock', async () => {
    const lockPath = await genFreshLockPath();

    // holder A runs a section across which we simulate a stealer B that reclaims the lock and writes
    // ITS OWN value (exactly what happens when A's section outlives LOCAL_LOCK_STALE_MSE). on release
    // A must compare-and-delete — it must NOT delete B's live lock.
    const stealerValue = `${Date.now()}.${randomUUID()}`;
    await withLocalKeyLock({ lockPath }, async () => {
      await fs.writeFile(lockPath, stealerValue, { encoding: 'utf-8' });
    });

    // B's lock survives A's release: A did not delete a lock it no longer owned. (with the prior
    // unconditional-delete release, this file would be gone — the exact mutual-exclusion break.)
    const afterRelease = await fs
      .readFile(lockPath, { encoding: 'utf-8' })
      .catch(() => null);
    expect(afterRelease).toEqual(stealerValue);
  });

  it('releases its own lock normally — the lock file is gone after an uncontended section', async () => {
    const lockPath = await genFreshLockPath();

    // an uncontended acquire → run → release: the lock file exists while held, gone after release
    await withLocalKeyLock({ lockPath }, async () => {
      const heldValue = await fs.readFile(lockPath, { encoding: 'utf-8' });
      expect(heldValue.length).toBeGreaterThan(0);
    });
    const afterRelease = await fs
      .readFile(lockPath, { encoding: 'utf-8' })
      .catch(() => null);
    expect(afterRelease).toEqual(null); // released — the lock file is gone
  });
});
