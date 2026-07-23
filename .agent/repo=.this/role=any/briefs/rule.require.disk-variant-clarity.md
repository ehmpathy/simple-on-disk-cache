# tldr

## severity: blocker

**"disk" is the umbrella term — a local disk and a cloud disk are both variants of a disk.
never use "disk" to mean the local variant alone.**

this repo persists a cache to a **disk**. a disk comes in two variants:

- **local disk** — the machine's own filesystem (a local tier)
- **cloud disk** — a remote object store, e.g. s3 (a cloud tier)

both are disks. that shared nature is the whole reason this package supports both behind one
`DirectoryToPersistTo = { local } | { cloud }` contract. when you mean one variant, say
**"local disk"** or **"cloud disk"** (or **"local tier"** / **"cloud tier"**). reserve bare
**"disk"** for the umbrella that covers both.

---
---
---

# deets

## .what

a name-clarity rule for every place the persistent store is named — code, comments, errors,
docs, tests. it fixes one canonical vocabulary:

| term | means | example referent |
|------|-------|------------------|
| **disk** | the umbrella — the persistent store, either variant | `saveToDisk` dispatches to both tiers |
| **local disk** / **local tier** | the machine filesystem variant | the `#lock` file, `fs.writeFile` |
| **cloud disk** / **cloud tier** | the remote object-store variant | s3, the `via` adapter, etag conditional writes |

## .why

**s3 is a disk.** it is a *cloud* disk, but a disk all the same. so "the disk tier" as a label
for the local filesystem is wrong — it silently claims the cloud store is not a disk, which is
false and misleads a reader about why the repo has two tiers at all.

the ambiguity is an **overload** (see `rule.require.ubiqlang`): the same word "disk" carries
two senses at once — both "the persistent store in general" AND "the local variant
specifically" — so a reader cannot tell which is meant without decode. that overload:

- **hides the symmetry** — a reader who assumes "disk = local" cannot see that local and cloud
  are two variants of one idea, which is exactly the abstraction the package sells.
- **misdirects debug work** — an error that says "the disk tier is per-machine" reads as if
  *all* disks are per-machine; the truth is only the *local* disk is per-machine (the cloud
  disk is global). the wrong word points the reader at the wrong mental model.
- **breaks the contract vocabulary** — the public type already names the variants `local` and
  `cloud`. prose that says "disk" for `local` desyncs from the type the caller reads.

## .where

applies everywhere the store is named:

- code: identifiers, types, function names
- comments: `.what` / `.why` blocks, inline notes
- errors: thrown messages + hints (these are snapshot-pinned — a fix here is an intended
  snapshot change, rationalize it)
- docs: readme, briefs
- tests: describe/it names, fixtures

## .how

ask: **"does this refer to the persistent store in general, or to one specific variant?"**

- general (covers both tiers) → **"disk"** is correct (`saveToDisk`, `readFromDisk` — they
  dispatch to both — are right)
- the machine filesystem only → **"local disk"** / **"local tier"** / **"local"**
- the remote object store only → **"cloud disk"** / **"cloud tier"** / **"cloud"**

if the sentence is only true for the machine filesystem (locks, `fs.*`, per-machine scope),
it must say **local**, not disk.

## .note

the atomicity asymmetry is a frequent trap for this rule: the **local disk** has no native
atomic compare-and-set, so the package synthesizes one with a per-key `#lock` file; the
**cloud disk** is atomic at the supplier (s3 `If-Match` / `If-None-Match`), so it needs no
lock. that difference is exactly where "disk" tempts you to mean "local" — say **"local
disk"** there.

## .examples

### positive

```ts
// disk = umbrella (dispatches to both variants) — correct
const saveToDisk = async ({ directory, key, value }) => {
  if (isLocalDirectory(directory)) { /* local disk */ }
  if (isCloudDirectory(directory)) { /* cloud disk */ }
};

// the local disk has no atomic compare-and-set, so we synthesize one with a lock;
// the cloud disk is atomic at the supplier, so it needs no lock.
const withLocalKeyLock = async (/* local-only */) => { /* ... */ };
```

```
// error hint — names the specific variant
"... the local tier is per-machine — for cross-machine coordination use the cloud (s3) tier."
```

### negative

```ts
// 👎 "disk tier" used to mean the LOCAL filesystem — s3 is a disk too
"... the disk tier is per-machine — for cross-machine coordination use the s3 tier."

// 👎 comment claims "disk" when the statement is only true of the local variant
// disk has no atomic compare-and-set   ← the CLOUD disk does; this is a LOCAL-only fact
```

## .citations

> "why do you say 'disk tier'? s3 is a disk — a cloud disk. do you mean local tier?"

source: repo owner, 2026-07-20
